import {courseId} from "./reader-courses.mjs";

const writes = new Set();
const dbName = courseId === "default" ? "stdoverwatch-reader" : "stdoverwatch-reader:course:" + courseId;
const database = new Promise((resolve, reject) => {
  const request = indexedDB.open(dbName, 1);
  request.onupgradeneeded = () => {
    for (const name of ["decks", "files", "activity", "studies", "progress"]) {
      request.result.createObjectStore(name, {keyPath: "id"});
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error("请关闭其他旧版阅读器标签页后刷新。"));
});

async function read(store, method, key) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store)[method](key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function write(stores, change) {
  const done = database.then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(stores, "readwrite");
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || new Error("保存失败。"));
    try { change(tx); }
    catch (error) { tx.abort(); reject(error); }
  }));
  writes.add(done);
  const release = () => writes.delete(done);
  done.then(release, release);
  return done;
}

export const flush = () => Promise.all(writes);
export const all = store => read(store, "getAll");
export const get = (store, id) => read(store, "get", id);
export const put = (store, entry) => write(store, tx => tx.objectStore(store).put(entry));
export const importDeck = (deck, file) => write(["decks", "files"], tx => {
  tx.objectStore("decks").put(deck);
  if (file) tx.objectStore("files").put({id: deck.id, file});
});
