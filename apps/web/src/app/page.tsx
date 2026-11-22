import { formatDublin } from "@rmc/core";

export default function Home() {
  return (
    <main style={{ padding: 24 }}>
      <h1>Royal Medics Clinic</h1>
      <p>Phase 1 scaffold. Server time (Dublin): {formatDublin(new Date())}</p>
    </main>
  );
}
