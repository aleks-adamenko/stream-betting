import { mockEvents } from "@/data/mockEvents";
import type { StreamEvent } from "@/domain/types";

/**
 * Events service — thin abstraction layer.
 * Phase 2: backed by in-memory mock data.
 * Phase 4: same signatures, swapped to Supabase queries. No call-site changes.
 */

function delay<T>(value: T, ms = 80): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export async function listEvents(): Promise<StreamEvent[]> {
  return delay([...mockEvents]);
}

export async function getEvent(id: string): Promise<StreamEvent | null> {
  const found = mockEvents.find((e) => e.id === id);
  return delay(found ?? null);
}
