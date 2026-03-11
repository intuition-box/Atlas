export const dynamic = "force-static";

export default function TermsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 py-24 sm:py-32">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Terms of Service</h1>
        <p className="text-muted-foreground">
          Last updated: February 2026
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">1. Acceptance of Terms</h2>
        <p className="text-muted-foreground">
          By accessing or using Atlas, you agree to be bound by these terms. If you do not agree, you may not use the platform.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">2. Description of Service</h2>
        <p className="text-muted-foreground">
          Atlas is a community directory built on the Intuition protocol. It enables members to create profiles, join communities, issue attestations, and visualize relationships through orbit metrics.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">3. Accounts</h2>
        <p className="text-muted-foreground">
          You are responsible for maintaining the security of your account and all activity that occurs under it. You must provide accurate information during registration and keep it up to date.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">4. Attestations</h2>
        <p className="text-muted-foreground">
          Attestations represent verifiable claims between members. Off-chain attestations can be removed at any time. Once an attestation is minted on-chain, staking can be withdrawn to revoke support, but the record remains on the blockchain.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">5. Acceptable Use</h2>
        <p className="text-muted-foreground">
          You agree not to use Atlas to harass, impersonate, or mislead others. You may not issue false or malicious attestations, attempt to manipulate orbit metrics, or use the platform for any unlawful purpose.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">6. Intellectual Property</h2>
        <p className="text-muted-foreground">
          Atlas and its original content, features, and functionality are owned by the Intuition team. You retain ownership of the content you create, but grant us a license to display it within the platform.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">7. Termination</h2>
        <p className="text-muted-foreground">
          We may suspend or terminate your access to Atlas at our discretion if you violate these terms. You may delete your account at any time. On-chain data will persist regardless of account status.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">8. Disclaimer of Warranties</h2>
        <p className="text-muted-foreground">
          Atlas is provided &ldquo;as is&rdquo; without warranties of any kind, express or implied. We do not guarantee that the service will be uninterrupted, secure, or error-free.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">9. Limitation of Liability</h2>
        <p className="text-muted-foreground">
          To the fullest extent permitted by law, we shall not be liable for any indirect, incidental, or consequential damages arising from your use of Atlas, including any losses related to on-chain transactions.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">10. Changes to Terms</h2>
        <p className="text-muted-foreground">
          We reserve the right to modify these terms at any time. Continued use of Atlas after changes constitutes acceptance of the updated terms.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">11. Contact</h2>
        <p className="text-muted-foreground">
          If you have questions about these terms, please reach out to us through the Atlas platform.
        </p>
      </section>
    </div>
  );
}
