/**
 * EXT-08. Interface only, no implementation. Phase 2 plugs a provider in (for example Daily.co) when online
 * consultations are built. Nothing in Phase 1 calls this.
 */
export interface VideoRoom {
  id: string;
  /** Where a participant joins. Never logged or emailed in full. */
  joinUrl: string;
  expiresAt: Date;
}

export interface VideoProvider {
  /** One room per consultation (appointments.consultation_id will point at the Phase 2 record). */
  createRoom(input: { appointmentId: string; startsAt: Date; endsAt: Date }): Promise<VideoRoom>;
  /** A short-lived token for one participant. */
  createJoinToken(input: { roomId: string; participantName: string; isDoctor: boolean; expiresAt: Date }): Promise<string>;
  endRoom(roomId: string): Promise<void>;
}
