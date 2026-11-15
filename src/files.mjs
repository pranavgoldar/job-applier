import fs from "node:fs/promises";
import path from "node:path";
export class LocalFiles {
  constructor(root) {
    this.root = path.resolve(root);
  }
  path(key) {
    const result = path.resolve(this.root, key);
    if (!result.startsWith(this.root + path.sep))
      throw new Error("Invalid private file key");
    return result;
  }
  async write(key, bytes, mime) {
    const file = this.path(key);
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await fs.writeFile(file, bytes, { mode: 0o600 });
    return key;
  }
  async read(key) {
    return fs.readFile(this.path(key));
  }
  async remove(key) {
    await fs.rm(this.path(key), { force: true });
  }
}
export class BlobFiles {
  constructor(token = process.env.BLOB_READ_WRITE_TOKEN, sdk = null) {
    if (!token)
      throw new Error(
        "Configure a private Vercel Blob store and BLOB_READ_WRITE_TOKEN",
      );
    this.token = token;
    this.sdk = sdk;
  }
  async write(key, bytes, mime) {
    const { put } = this.sdk || (await import("@vercel/blob"));
    await put(key, bytes, {
      access: "private",
      contentType: mime,
      addRandomSuffix: false,
      allowOverwrite: false,
      token: this.token,
    });
    return key;
  }
  async read(key) {
    const { get } = this.sdk || (await import("@vercel/blob"));
    const r = await get(key, {
      access: "private",
      token: this.token,
      useCache: false,
    });
    if (r?.statusCode !== 200 || !r.stream)
      throw new Error("Private file not found");
    return Buffer.from(await new Response(r.stream).arrayBuffer());
  }
  async remove(key) {
    const { del } = this.sdk || (await import("@vercel/blob"));
    await del(key, { token: this.token });
  }
}
