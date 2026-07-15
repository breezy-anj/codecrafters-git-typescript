import * as fs from "fs";
import * as crypto from "crypto";
import * as zlib from "zlib";
import * as path from "path";
const args = process.argv.slice(2);
const command = args[0];

async function fetchResponse(url: string) {
  try {
    const response = await fetch(`${url}/info/refs?service=git-upload-pack`);

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.text();
    console.log("--RAW GIT RESPONSE--");

    console.log("Success:", data.toString());
    return data.toString();
  } catch (error) {
    console.error("Error: " + error);
  }
}
function writeBlobObject(filePath: string): string {
  const fileContent = fs.readFileSync(filePath);
  const length = fileContent.length;
  const headerString = `blob ${length}\0`;
  const buffer = Buffer.from(headerString);
  const payload = Buffer.concat([buffer, fileContent]);
  const hash = crypto.createHash("sha1").update(payload).digest("hex"); //NEW

  if (process.argv.includes("-w")) {
    const dir = hash.substring(0, 2);
    const fileName = hash.substring(2);
    const targetPath = path.join(".git", "objects", dir);
    fs.mkdirSync(targetPath, { recursive: true });
    const compressed = zlib.deflateSync(payload);
    fs.writeFileSync(path.join(targetPath, fileName), compressed);
  }
  return hash;
}

function writeTreeObject(directoryPath: string): string {
  let treeEntries: Buffer[] = [];
  const entries = fs
    .readdirSync(directoryPath)
    .filter((entry) => entry !== ".git")
    .sort();

  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry);
    const stat = fs.statSync(absolutePath);

    if (stat.isFile()) {
      const hash = writeBlobObject(absolutePath);
      const modeAndName = `100644 ${entry}\0`;
      const entryBuffer = Buffer.concat([
        Buffer.from(modeAndName),
        Buffer.from(hash, "hex"),
      ]);
      treeEntries.push(entryBuffer);
    } else if (stat.isDirectory()) {
      const hash = writeTreeObject(absolutePath);
      const modeAndName = `40000 ${entry}\0`;
      const entryBuffer = Buffer.concat([
        Buffer.from(modeAndName),
        Buffer.from(hash, "hex"),
      ]);
      treeEntries.push(entryBuffer);
    }
  }

  const treeData = Buffer.concat(treeEntries);
  const header = Buffer.from(`tree ${treeData.length}\0`);
  const fullPayload = Buffer.concat([header, treeData]);
  const treeHash = crypto.createHash("sha1").update(fullPayload).digest("hex");
  const dir = treeHash.substring(0, 2);
  const fileName = treeHash.substring(2);
  const targetPath = path.join(".git", "objects", dir);

  fs.mkdirSync(targetPath, { recursive: true });
  fs.writeFileSync(
    path.join(targetPath, fileName),
    zlib.deflateSync(fullPayload),
  );
  return treeHash;
}

switch (command) {
  case "init":
    fs.mkdirSync(".git", { recursive: true });
    fs.mkdirSync(".git/objects", { recursive: true });
    fs.mkdirSync(".git/refs", { recursive: true });
    fs.writeFileSync(".git/HEAD", "ref: refs/heads/main\n");
    console.log("Initialized git directory");
    break;

  case "cat-file": {
    const dir = args[2].substring(0, 2);
    const fileName = args[2].substring(2);
    const targetPath = path.join(".git", "objects", dir, fileName);
    const content = fs.readFileSync(targetPath);
    const uncompressedContent = zlib.unzipSync(content);
    const nullByteIndex = uncompressedContent.indexOf(0);
    const fileContentBuffer = uncompressedContent.subarray(nullByteIndex + 1);
    process.stdout.write(fileContentBuffer);
    break;
  }
  case "hash-object": {
    const filePath = process.argv.at(-1) as string;
    process.stdout.write(writeBlobObject(filePath) + "\n");
    break;
  }
  case "write-tree": {
    const hash = writeTreeObject(process.cwd());
    process.stdout.write(hash + "\n");
    break;
  }

  case "ls-tree": {
    const hash = process.argv.at(-1);
    if (!hash) {
      console.log("Hash is empty");
      break;
    }
    const dir = hash.substring(0, 2);
    const fileName = hash.substring(2);
    const buffer = fs.readFileSync(path.join(".git", "objects", dir, fileName));
    const uncompressed = zlib.unzipSync(buffer);
    const nullByteIndex = uncompressed.indexOf(0);
    let cursor = nullByteIndex + 1;

    const names: string[] = [];
    while (cursor < uncompressed.length) {
      const spaceIndex = uncompressed.indexOf(32, cursor); //NEW
      const nullIndex = uncompressed.indexOf(0, spaceIndex);
      const nameBuffer = uncompressed.subarray(spaceIndex + 1, nullIndex); // NEW subarray for buffers
      names.push(nameBuffer.toString("utf-8"));

      cursor = nullIndex + 21;
    }

    names.sort();
    names.forEach((name) => process.stdout.write(name + "\n"));
    break;
  }

  case "commit-tree": {
    const cmd = process.argv;
    const treeSha = cmd.at(3);
    const parentSha = cmd.at(cmd.indexOf("-p") + 1);
    const message = cmd.at(cmd.indexOf("-m") + 1);

    if (!treeSha || !parentSha) {
      throw new Error(`Unknown command`);
      break;
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const commitContent = `tree ${treeSha}
parent ${parentSha}
author John Doe <john@example.com> ${timestamp} +0000
committer John Doe <john@example.com> ${timestamp} +0000

${message}
`;

    const buffer: Buffer = Buffer.from(commitContent);
    const headerBuffer = Buffer.from("commit " + commitContent.length + "\0");
    const payload = Buffer.concat([headerBuffer, buffer]);
    const hash = crypto.createHash("sha1").update(payload).digest("hex");

    const dir = hash.substring(0, 2);
    const fileName = hash.substring(2);
    const targetPath = path.join(".git", "objects", dir);
    fs.mkdirSync(targetPath, { recursive: true });
    const compressed = zlib.deflateSync(payload);
    fs.writeFileSync(path.join(targetPath, fileName), compressed);

    process.stdout.write(hash);
    break;
  }

  case "clone": {
    const targetDir = process.argv.at(-1) as string;
    const url = process.argv.at(-2) as string;

    fs.mkdirSync(path.join(targetDir, ".git"), { recursive: true });
    fs.mkdirSync(path.join(targetDir, ".git/objects"), { recursive: true });
    fs.mkdirSync(path.join(targetDir, ".git/refs"), { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, ".git/HEAD"),
      "ref: refs/heads/main\n",
    );
    console.log("Initialized git directory");

    fetchResponse(url).then(async (data) => {
      const match = data.match(/([a-f0-9]{40}) HEAD/);
      if (!match) {
        throw new Error("Could not find commit hash in server response.");
      }
      const hash = match[1];
      const requestBody = `0032want ${hash}\n00000009done\n`;
      const packfileResponse = await fetch(`${url}/git-upload-pack`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-git-upload-pack-request",
        },
        body: requestBody,
      });

      const buffer = Buffer.from(await packfileResponse.arrayBuffer());
      console.log(`Received Packfile of length: ${buffer.length} bytes`);

      const nak = buffer.subarray(0, 8).toString("utf-8");
      console.log(`Server Ack: ${nak.trim()}`);

      const signature = buffer.subarray(8, 12).toString("utf-8");
      const version = buffer.readUInt32BE(12);
      const objectCount = buffer.readUInt32BE(16);

      console.log(`Signature: ${signature}`);
      console.log(`Version: ${version}`);
      console.log(`Object Count: ${objectCount}`);

      let cursor = 20;

      const typeMap: Record<number, string> = {
        1: "commit",
        2: "tree",
        3: "blob",
        4: "tag",
      };

      for (let i = 0; i < objectCount; i++) {
        let byte = buffer[cursor];
        cursor++;

        const typeInt = (byte & 0b01110000) >> 4;
        let size = byte & 0b00001111;
        let shift = 4;

        while (byte & 0b10000000) {
          byte = buffer[cursor];
          cursor++;
          size |= (byte & 0b01111111) << shift;
          shift += 7;
        }

        const objectType = typeMap[typeInt];

        if (!objectType) {
          console.log(
            `\nFatal: Encountered Delta Object (Type ${typeInt}) at Object ${i + 1}.`,
          );
          break;
        }

        let compressedLength = 1;
        let uncompressedData: Buffer;

        while (true) {
          try {
            uncompressedData = zlib.inflateSync(
              buffer.subarray(cursor, cursor + compressedLength),
            );
            break;
          } catch (error: any) {
            compressedLength++;
          }
        }

        cursor += compressedLength;

        if (objectType !== "delta") {
          const header = Buffer.from(`${objectType} ${size}\0`);
          const fullPayload = Buffer.concat([header, uncompressedData]);
          const hash = crypto
            .createHash("sha1")
            .update(fullPayload)
            .digest("hex");

          const dir = hash.substring(0, 2);
          const fileName = hash.substring(2);

          const targetPath = path.join(targetDir, ".git", "objects", dir);
          fs.mkdirSync(targetPath, { recursive: true });
          fs.writeFileSync(
            path.join(targetPath, fileName),
            zlib.deflateSync(fullPayload),
          );
          console.log(`Unpacked ${objectType} -> ${hash}`);
        } else {
          console.log(
            `Delta payload uncompressed length: ${uncompressedData.length} bytes`,
          );
          break;
        }
      }
    });

    break;
  }
  default:
    throw new Error(`Unknown command ${command}`);
}
