#!/bin/bash

set -e
cd `dirname $0`

# bump version
echo 'require("fs").writeFileSync("package.json", JSON.stringify({...require("./package.json"), version: require("./package.json").version.split(".").map((v, i, a) => i === a.length - 1 ? parseInt(v) + 1 : v).join(".")}, null, 2) + "\n");' | node

# build and publish

npm run build-and-publish
