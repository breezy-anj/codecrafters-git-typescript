import * as fs from "fs";
import * as crypto from "crypto";
import * as zlib from "zlib";
import * as path from "path";
const args = process.argv.slice(2);
const command = args[0];

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
  default:
    throw new Error(`Unknown command ${command}`);
}
