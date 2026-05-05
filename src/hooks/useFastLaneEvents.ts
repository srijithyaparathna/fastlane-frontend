export type { FLEvent } from "@/hooks/useFastLane";
import { useFastLane } from "@/hooks/useFastLane";

// Thin wrapper so events.tsx needs no changes: returns { events, clear }
export function useFastLaneEvents(_max?: number) {
  const { events, clearEvents } = useFastLane();
  return { events, clear: clearEvents };
}
