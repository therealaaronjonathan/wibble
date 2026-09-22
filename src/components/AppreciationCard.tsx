// The daily appreciation message — the emotional core of v1.
export default function AppreciationCard({ message }: { message: string }) {
  return (
    <section className="appreciation" aria-label="A note for you">
      <p className="appreciation-text">{message}</p>
    </section>
  );
}
