import type { ReviewDocument } from '@/lib/review-materials';

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('museum-review-materials', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('workspace'); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadReviewDocuments(): Promise<ReviewDocument[]> {
  await writeQueue.catch(() => {});
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('workspace', 'readonly');
      const request = transaction.objectStore('workspace').get('documents');
      transaction.oncomplete = () => resolve(Array.isArray(request.result) ? request.result : []);
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
  } finally { database.close(); }
}

let writeQueue: Promise<void> = Promise.resolve();
export function saveReviewDocuments(documents: ReviewDocument[]) {
  const save = writeQueue.catch(() => {}).then(async () => {
    const database = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('workspace', 'readwrite');
        transaction.objectStore('workspace').put(documents, 'documents');
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () => reject(transaction.error);
      });
    } finally { database.close(); }
  });
  writeQueue = save;
  return save;
}
