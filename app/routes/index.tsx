import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
      <section className="flex flex-col items-start gap-6 py-16 sm:py-24">
        <p className="text-sm font-semibold uppercase tracking-wide text-gray-500">Denver pilot</p>

        <h1 className="max-w-3xl text-3xl font-bold tracking-tight sm:text-5xl">
          Find restaurants you can actually trust to be gluten-free.
        </h1>

        <p className="max-w-2xl text-base text-gray-600 sm:text-lg">
          Aubrey's List is a community directory of how safe restaurants really are for people with
          a gluten-free or celiac need. Every listing is contributed, attested, and kept fresh by
          people who live with the same stakes — so you can tell celiac-safe from merely
          "gluten-friendly" before you order.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* Placeholder CTA — browse/search lands in a later issue. */}
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-700"
          >
            Browse Denver listings
          </Link>
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Add a listing
          </Link>
        </div>
      </section>
    </div>
  );
}
