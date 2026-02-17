export const dynamic = "force-static";

export default function PolicyPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 py-24 sm:py-32">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="text-muted-foreground">
          Last updated: February 2026
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">1. Information We Collect</h2>
        <p className="text-muted-foreground">
          When you use Atlas, we collect information you provide directly, such as your name, email address, and profile details. We also collect usage data including interactions, attestations, and community memberships.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">2. How We Use Your Information</h2>
        <p className="text-muted-foreground">
          We use the information we collect to operate, maintain, and improve Atlas, including computing orbit metrics, processing attestations, and personalizing your experience.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">3. Information Sharing</h2>
        <p className="text-muted-foreground">
          Your public profile, attestations, and community memberships are visible to other users. We do not sell your personal information to third parties. We may share data with service providers who assist in operating Atlas.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">4. On-Chain Data</h2>
        <p className="text-muted-foreground">
          Attestations minted on-chain are recorded on a public blockchain and cannot be deleted or modified. Please consider this before minting any attestation. Off-chain attestations can be retracted at any time.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">5. Data Security</h2>
        <p className="text-muted-foreground">
          We implement industry-standard security measures to protect your information. However, no method of
          transmission over the internet is completely secure.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">6. Cookies</h2>
        <p className="text-muted-foreground">
          Atlas uses essential cookies required for authentication and security. We do not use tracking or advertising cookies.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">7. Your Rights</h2>
        <p className="text-muted-foreground">
          You may access, update, or delete your account information at any time through your profile settings. You may also request a copy of your data or ask us to delete your account entirely.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">8. Changes to This Policy</h2>
        <p className="text-muted-foreground">
          We may update this policy from time to time. We will notify you of material changes by posting the updated policy on this page with a revised date.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">9. Contact</h2>
        <p className="text-muted-foreground">
          If you have questions about this privacy policy, please reach out to us through the Atlas platform.
        </p>
      </section>
    </div>
  );
}
