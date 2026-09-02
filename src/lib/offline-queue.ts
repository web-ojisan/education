// オフライン中に送信できなかった回答ログを一時的に保存しておくためのキュー。
// 生のIndexedDB APIを最小限ラップしただけのもの(新規npm依存は増やさない方針)。
// オンライン復帰時に drainAnswerLogQueue() で貯まった分をまとめて送信する。

const DB_NAME = 'education-offline-queue';
const STORE_NAME = 'answer_logs';
const DB_VERSION = 1;

export type QueuedAnswerLog = {
  child_id: string;
  problem_id: string;
  is_correct: boolean;
  started_at: string;
  completed_at: string;
  context: 'drill' | 'ghost_race';
  /** 5問1セット等のまとまりを示すID(ゴーストレースの再生単位にもなる) */
  session_id: string | null;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'queuedId', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 送信できなかった回答ログを1件キューに積む */
export async function enqueueAnswerLog(entry: QueuedAnswerLog): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/**
 * キューに溜まっている回答ログを先頭から順に送信する。
 * send が成功したものだけキューから取り除き、失敗したものは残す
 * (次回のオンライン復帰時に再送する)。
 */
export async function drainAnswerLogQueue(
  send: (entry: QueuedAnswerLog) => Promise<{ error: unknown }>
): Promise<void> {
  const db = await openDb();
  const entries = await new Promise<{ queuedId: number; entry: QueuedAnswerLog }[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).openCursor();
    const results: { queuedId: number; entry: QueuedAnswerLog }[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const { queuedId, ...entry } = cursor.value as QueuedAnswerLog & { queuedId: number };
        results.push({ queuedId, entry });
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
  });

  for (const { queuedId, entry } of entries) {
    const { error } = await send(entry);
    if (error) continue;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(queuedId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  db.close();
}
