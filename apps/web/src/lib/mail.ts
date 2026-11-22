import { processOutbox } from "@rmc/core";
import { after } from "next/server";
import { db, mailDeps } from "./server";

/** Sends any queued emails. Never throws: a failed send is retried by the next run (every 5 minutes). */
export async function dispatchEmails(): Promise<void> {
  try {
    await processOutbox(db(), mailDeps());
  } catch (err) {
    // Only the error type is logged: messages can contain a patient's address.
    console.error(`[email] dispatch failed: ${err instanceof Error ? err.name : typeof err}`);
  }
}

/**
 * Runs after the response has been sent, so the patient is not kept waiting for the email provider.
 * Outside a request (tests, scripts) it simply runs in the background.
 */
export function afterResponse(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    void task();
  }
}

export const sendEmailsSoon = () => afterResponse(dispatchEmails);
