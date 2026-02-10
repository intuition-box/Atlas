export const dynamic = "force-static";

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 py-24 sm:py-32">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">About Atlas</h1>
        <p className="text-muted-foreground">
          Atlas is a directory where members join and appear as orbiting nodes around their communities. It is a visual summary of a member’s relationship to a community.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Gravity, Love, Reach</h2>
        <p className="text-muted-foreground">
          Atlas treats facts/attestations as first-class actions and uses them to compute human-readable orbit metrics.
          Current scoring is heuristic and designed to evolve.
        </p>

        <div className="space-y-3">
          <div>
            <div className="font-medium">Gravity</div>
            <p className="text-sm text-muted-foreground">
              A community-relative “pull” signal combining relationship and participation. Stabilizes orbit levels and
              will later power sorting and recommendations.
            </p>
          </div>
          <div>
            <div className="font-medium">Love</div>
            <p className="text-sm text-muted-foreground">
              Relationship strength around a member. Higher when the member participates and receives positive
              attestations. Helps determine orbit level.
            </p>
          </div>
          <div>
            <div className="font-medium">Reach</div>
            <p className="text-sm text-muted-foreground">
              How visible or referenced a member is in a community. Higher when the member is frequently attested to.
              Used primarily for node size.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Orbit layers</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">Ring (distance)</span> = Orbit Level
          </li>
          <li>
            <span className="font-medium text-foreground">Dot size</span> = Reach
          </li>
          <li>
            <span className="font-medium text-foreground">Dot brightness</span> = Recency (based on activity)
          </li>
        </ul>

        <h2 className="text-xl font-semibold">Orbit positions</h2>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">Advocates</span> (closest)
          </li>
          <li>
            <span className="font-medium text-foreground">Contributors</span>
          </li>
          <li>
            <span className="font-medium text-foreground">Participants</span>
          </li>
          <li>
            <span className="font-medium text-foreground">Explorers</span> (outermost)
          </li>
        </ol>
      </section>
    </div>
  );
}