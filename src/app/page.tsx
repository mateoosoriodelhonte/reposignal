export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        Understand a GitHub repository in 30 seconds.
      </h1>
      <p className="text-muted mt-4 max-w-2xl text-lg">
        RepoSignal analyzes engineering health using public repository evidence.
      </p>
      <p className="text-muted mt-8 text-sm">
        The analysis pipeline is under construction. See{' '}
        <a
          className="text-accent underline underline-offset-4"
          href="https://github.com/mateoosoriodelhonte/reposignal/milestone/1"
          rel="noopener noreferrer"
          target="_blank"
        >
          the v1.0 milestone
        </a>{' '}
        for progress.
      </p>
    </div>
  );
}
