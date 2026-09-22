import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { LibreLinkUpClient } from "@diakem/libre-link-up-api-client";

initializeApp();
const db = getFirestore();

// LibreLinkUp follower credentials, stored in Google Secret Manager.
// Set via: firebase functions:secrets:set LLU_USERNAME / LLU_PASSWORD
const LLU_USERNAME = defineSecret("LLU_USERNAME");
const LLU_PASSWORD = defineSecret("LLU_PASSWORD");

// One reading shape, as returned by @diakem/libre-link-up-api-client.
// trend is a string union ('Flat' | 'SingleUp' | ...), stored as-is and
// mapped to an arrow in the frontend.
type Cgm = {
  value: number;
  isHigh: boolean;
  isLow: boolean;
  trend: string;
  date: Date;
};

/**
 * Map a LibreLinkUp reading to a Firestore doc.
 * Doc id = measurement epoch ms, so re-polling the same reading upserts
 * instead of duplicating (idempotent).
 *
 *   reading.date (Date) --> id = epoch ms --> readings/{id}
 */
function toDoc(r: Cgm) {
  const measuredAt = r.date instanceof Date ? r.date : new Date(r.date);
  return {
    id: String(measuredAt.getTime()),
    data: {
      valueMgdl: r.value,
      trend: r.trend ?? "NotComputable",
      isHigh: r.isHigh ?? false,
      isLow: r.isLow ?? false,
      measuredAt: Timestamp.fromDate(measuredAt),
      ingestedAt: Timestamp.now(),
    },
  };
}

/**
 * Poll LibreLinkUp every 1 minute and mirror readings into Firestore.
 *
 *   Secret Manager creds --> LibreLinkUpClient.read()
 *        --> { current, history }
 *        --> batch upsert into top-level `readings` collection
 *
 * Single-user app: glucose is household-level, not keyed to an auth uid,
 * so the poller can run and be verified before any frontend/auth exists.
 * The login / JWT refresh / EU-US region handling all live inside the client.
 */
export const pollGlucose = onSchedule(
  {
    schedule: "every 1 minutes",
    secrets: [LLU_USERNAME, LLU_PASSWORD],
    region: "us-central1",
    timeoutSeconds: 60,
  },
  async () => {
    try {
      const { read } = LibreLinkUpClient({
        username: LLU_USERNAME.value(),
        password: LLU_PASSWORD.value(),
        // Abbott 403s stale versions (body gives required minimumVersion). Bump if it 403s again.
        clientVersion: "4.16.0",
      });

      const { current, history } = await read();
      if (!current) {
        console.warn("[pollGlucose] no current reading returned");
        return;
      }

      const col = db.collection("readings");
      const batch = db.batch();

      // Seed the sparkline with the recent series (idempotent by measurement time).
      for (const r of history ?? []) {
        const { id, data } = toDoc(r);
        batch.set(col.doc(id), data, { merge: true });
      }
      // The current reading is also the one the hero displays.
      const cur = toDoc(current);
      batch.set(col.doc(cur.id), cur.data, { merge: true });

      await batch.commit();
      console.log(
        `[pollGlucose] ${current.value} mg/dL (${current.trend}) @ ` +
          `${cur.data.measuredAt.toDate().toISOString()} | +${history?.length ?? 0} history pts`
      );
    } catch (err) {
      console.error("[pollGlucose] poll failed:", err);
      // Swallow: keep the last good reading, next cycle retries.
    }
  }
);
