import { connect, io, Socket } from "socket.io-client";
import { exec } from "child_process";

const DEFAULT_SERVER = "https://client-socket.codapt.ai/";

// begin shared types

interface CommandPayload {
  command: string;
  timeoutMs: number | null;
}

interface CommandResponse {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface ServerToClientEvents {
  runCommand: (
    payload: CommandPayload,
    callback: (response: CommandResponse) => void
  ) => void;

  emitToStdout: (text: string, callback: () => void) => void;

  readLine: (callback: (line: string) => void) => void;

  startLoading: (
    text: string,
    timeoutMs: number | null,
    callback: () => void
  ) => void;

  stopLoading: (callback: () => void) => void;

  getEnvInfo: (callback: (envInfo: EnvInfo) => void) => void;

  terminate: () => void;
}

interface EnvInfo {
  argv: string[];
  env: Record<string, string | undefined>;
  cwd: string;
  pid: number;
}

interface ClientToServerEvents {}

// end shared types

// begin helper functions

const runCommand = (payload: CommandPayload): Promise<CommandResponse> => {
  return new Promise((resolve, reject) => {
    const { command, timeoutMs } = payload;

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
      }
    );

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

  debugLog(`Starting loading: ${text} with timeout ${timeoutMs}ms`);

  if (timeoutMs != null) {
    setTimeout(() => {
      stopLoading();
    }, timeoutMs);
  }

  const spinnerChars = ["|", "/", "-", "\\"];
  let i = 0;

  loadingInterval = setInterval(() => {
    clearLine();
    process.stdout.write(spinnerChars[i]! + " " + text);
    i = (i + 1) % spinnerChars.length;
  }, 100);
}

// end helper functions

let server = DEFAULT_SERVER;

if (process.env.CODAPT_SERVER) {
  server = process.env.CODAPT_SERVER;
}

const socket: Socket<ServerToClientEvents, ClientToServerEvents> =
  connect(server);

// begin socket handlers

socket.on("connect", () => {
  debugLog("Connected to server, sending start event");
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

socket.on("emitToStdout", (text, callback) => {
  stopLoading();
  process.stdout.write(text);
  callback();
});

socket.on("readLine", (callback) => {
  stopLoading();

  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  process.stdin.once("data", (text) => {
    process.stdin.pause();
    callback(text);
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
  debugLog("Disconnected from server.");
});

// end socket handlers
