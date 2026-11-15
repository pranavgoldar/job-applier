export async function createStore({ cloud = !!process.env.VERCEL } = {}) {
  if (cloud) {
    const { CloudStore } = await import("./cloud-store.mjs");
    return CloudStore.open();
  }
  const { Store } = await import("./store.mjs");
  return new Store();
}
