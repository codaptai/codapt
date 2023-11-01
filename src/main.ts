import { connect, io, Socket } from "socket.io-client";
import { exec } from "child_process";

const DEFAULT_SERVER = "https://client-socket.codapt.ai/";

// begin shared types

interface CommandPayload {
  command: string;
  stdin: string | null;
  timeoutMs: number | null;
}

interface CommandResponse {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface EnvInfo {
  argv: string[];
  env: Record<string, string | undefined>;
  cwd: string;
  pid: number;
}

interface ServerToClientEvents {
  runCommand: (
    payload: CommandPayload,
    callback: (response: CommandResponse) => void,
  ) => void;

  print: (text: string, callback: () => void) => void;

  readStdin: (callback: (line: string) => void) => void;

  startLoading: (
    text: string,
    timeoutMs: number | null,
    callback: () => void,
  ) => void;

  stopLoading: (callback: () => void) => void;

  getEnvInfo: (callback: (envInfo: EnvInfo) => void) => void;

  terminate: () => void;
}

interface ClientToServerEvents {}

// end shared types

// begin helper functions

const runCommand = (payload: CommandPayload): Promise<CommandResponse> => {
  return new Promise((resolve, reject) => {
    const { command, timeoutMs, stdin } = payload;

    const child = exec(
      command,
      { timeout: timeoutMs ?? undefined },
      (error, stdout, stderr) => {
        if (error) {
          resolve({
            exitCode: error.code || -1,
            stdout,
            stderr,
          });
        } else {
          resolve({
            exitCode: 0,
            stdout,
            stderr,
          });
        }
      },
    );

    // If stdin is provided, write it to the child process's stdin
    if (stdin != null) {
      if (child.stdin == null) {
        throw new Error("unexpected: child.stdin is null");
      }
      child.stdin.write(stdin);
      child.stdin.end();
    }

    // Handle possible errors related to command execution itself (e.g., command not found)
    child.on("error", (err) => {
      reject({
        exitCode: -1,
        stdout: "",
        stderr: err.message,
      });
    });
  });
};

function debugLog(message: string) {
  if (process.env.CODAPT_DEBUG) {
    console.log(`[CODAPT CLIENT DEBUG] ${message}`);
  }
}

let loadingInterval: NodeJS.Timeout | null = null;
let lastLoadingLineWritten: string = "";

function writeLastLoadingLine() {
  process.stdout.write(lastLoadingLineWritten);
}

function clearLine() {
  process.stdout.write("\u001b[0G\u001b[2K");
}

function stopLoading() {
  if (loadingInterval) {
    clearInterval(loadingInterval);
    loadingInterval = null;
    clearLine();
  }
}

function startLoading(text: string, timeoutMs: number | null) {
  stopLoading();

  debugLog(`Starting loading: ${text} with timeoutMs=${timeoutMs}`);

  if (timeoutMs != null) {
    setTimeout(() => {
      stopLoading();
    }, timeoutMs);
  }

  const spinnerChars = ["|", "/", "-", "\\"];
  let i = 0;

  loadingInterval = setInterval(() => {
    clearLine();
    lastLoadingLineWritten = spinnerChars[i]! + " " + text;
    writeLastLoadingLine();
    i = (i + 1) % spinnerChars.length;
  }, 100);
}

// end helper functions

let server = DEFAULT_SERVER;

if (process.env.CODAPT_SERVER) {
  server = process.env.CODAPT_SERVER;
}

async function main() {
  startLoading("Connecting to server...", 5000);
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = connect(
    server,
    { timeout: 5000 },
  );

  // begin socket handlers

  socket.on("connect", () => {
    stopLoading();
    debugLog("Connected to server");
  });

  socket.on("getEnvInfo", (callback) => {
    debugLog("Received getEnvInfo request");

    const envInfo: EnvInfo = {
      argv: process.argv,
      env: process.env,
      cwd: process.cwd(),
      pid: process.pid,
    };

    callback(envInfo);
  });

  socket.on("runCommand", (payload, callback) => {
    debugLog(`Received command: ${payload.command}`);

    runCommand(payload)
      .then((response) => {
        debugLog(`Command succeeded: ${payload.command}`);
        callback(response);
      })
      .catch((error) => {
        debugLog(`Command failed: ${payload.command}`);
        callback(error);
      });
  });

  socket.on("print", (text, callback) => {
    if (loadingInterval) {
      clearLine();
    }
    process.stdout.write(text);
    if (loadingInterval) {
      writeLastLoadingLine();
    }
    callback();
  });

  socket.on("readStdin", (callback) => {
    stopLoading();

    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    process.stdin.once("data", (text) => {
      process.stdin.pause();
      callback(text.toString());
    });
  });

  socket.on("startLoading", (text, timeoutMs, callback) => {
    startLoading(text, timeoutMs);
    callback();
  });

  socket.on("stopLoading", (callback) => {
    stopLoading();
    debugLog("Stopping loading");
    callback();
  });

  socket.on("terminate", () => {
    debugLog("Terminating");
    process.exit(0);
  });

  socket.on("disconnect", () => {
    debugLog("Disconnected from server, terminating...");
    process.exit(0);
  });

  // end socket handlers
}

main();
