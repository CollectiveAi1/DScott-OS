export default function GateLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-12">
      <section className="w-full max-w-sm">
        <p className="mb-8 font-mono text-xs uppercase tracking-[0.2em] text-accent">DScott OS</p>
        {children}
      </section>
    </main>
  );
}
