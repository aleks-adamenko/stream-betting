import { PageContainer } from "@/components/layout/PageContainer";

/**
 * Privacy Policy — Australian-law document covering Privacy Act 1988
 * compliance, the Australian Privacy Principles, marketing, overseas
 * disclosure, NDB obligations, additional EU/UK/CA rights, and complaints.
 *
 * Source: legal draft template adapted on operator request. Substitutions
 * applied:
 *   • Company name → "Liverush" (no Pty Ltd, no ABN/ACN)
 *   • Address fields → removed
 *   • Contact email → support@liverush.co
 *
 * Layout mirrors the Terms page so the two reads stay consistent.
 */
export default function Privacy() {
  return (
    <PageContainer className="lg:pt-12">
      <article className="mx-auto w-full max-w-3xl space-y-6 text-sm leading-relaxed text-foreground/85 sm:text-base">
        <header className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
            Legal
          </p>
          <h1 className="font-heading text-3xl font-bold text-foreground sm:text-4xl">
            Privacy Policy
          </h1>
          <p className="text-sm text-muted-foreground">
            Last updated: 4 June 2026
          </p>
        </header>

        <p>
          <strong>Liverush</strong> (&ldquo;<strong>Liverush</strong>&rdquo;,
          &ldquo;<strong>we</strong>&rdquo;, &ldquo;<strong>us</strong>&rdquo;,
          &ldquo;<strong>our</strong>&rdquo;) operates the Liverush platform
          (the &ldquo;<strong>Service</strong>&rdquo;). We are committed to
          protecting your privacy and handling your personal information in
          accordance with the <em>Privacy Act 1988</em> (Cth) and the
          Australian Privacy Principles (&ldquo;<strong>APPs</strong>&rdquo;).
        </p>

        <p>
          This Privacy Policy explains what personal information we collect,
          how we use and disclose it, and how you can access, correct or
          complain about how we handle it.
        </p>

        <Section title="1. The information we collect">
          <p>We may collect the following categories of personal information:</p>
          <p>
            <strong>(a) Account and profile information</strong> &mdash; name
            or username, email address, date of birth or age confirmation,
            password (stored in hashed form), and profile details you choose
            to provide.
          </p>
          <p>
            <strong>(b) Verification information</strong> &mdash; information
            used to confirm you are 18 or older and to prevent fraud or
            duplicate accounts.
          </p>
          <p>
            <strong>(c) Transaction information</strong> &mdash; records of
            your Rush Coin purchases and in-app activity. Card and payment
            details are collected and processed by our third-party payment
            providers; we do not store full card numbers.
          </p>
          <p>
            <strong>(d) Usage and device information</strong> &mdash; IP
            address, device identifiers, browser type, operating system, log
            data, pages viewed, and interactions with the Service, collected
            automatically including via cookies and similar technologies.
          </p>
          <p>
            <strong>(e) Communications</strong> &mdash; messages, support
            requests, and feedback you send us.
          </p>
          <p>
            We collect only the personal information reasonably necessary for
            our functions and activities.
          </p>
        </Section>

        <Section title="2. How we collect personal information">
          <p>We collect personal information:</p>
          <Letters>
            <li>
              <strong>directly from you</strong> when you register, purchase
              Rush Coins, use the Service, or contact us;
            </li>
            <li>
              <strong>automatically</strong> through your use of the Service
              (e.g. cookies, analytics, server logs);
            </li>
            <li>
              <strong>from third parties</strong> such as payment providers,
              identity/age-verification providers, and analytics or anti-fraud
              providers, where reasonable and lawful.
            </li>
          </Letters>
          <p>
            If you provide personal information about another person, you must
            ensure you are authorised to do so.
          </p>
        </Section>

        <Section title="3. Why we collect, hold, use and disclose your information">
          <p>We use personal information to:</p>
          <Letters>
            <li>
              create and manage your account and verify eligibility (including
              age);
            </li>
            <li>
              operate the Service, including processing Rush Coin purchases
              and enabling gameplay;
            </li>
            <li>provide customer support and respond to enquiries;</li>
            <li>
              maintain security, prevent fraud, detect prohibited conduct
              (such as collusion or multi-accounting), and comply with our
              legal obligations;
            </li>
            <li>
              improve and develop the Service and understand how it is used;
            </li>
            <li>
              send you service-related and, where permitted, marketing
              communications (see Section 8);
            </li>
            <li>
              comply with applicable laws and respond to lawful requests.
            </li>
          </Letters>
          <p>
            We will only use or disclose personal information for the purpose
            for which it was collected, a related purpose you would reasonably
            expect, or as otherwise permitted or required by law.
          </p>
        </Section>

        <Section title="4. Cookies and tracking technologies">
          <p>
            We use cookies and similar technologies to operate the Service,
            remember your preferences, maintain security, and analyse usage.
            You can manage cookies through your browser settings, though some
            features may not function correctly if you disable them.
          </p>
        </Section>

        <Section title="5. Disclosure of personal information">
          <p>We may disclose personal information to:</p>
          <Letters>
            <li>
              <strong>service providers</strong> who help us operate the
              Service, including payment processors, hosting and cloud
              infrastructure, live-streaming infrastructure, analytics,
              communications, and fraud-prevention providers;
            </li>
            <li>
              <strong>professional advisers</strong> such as lawyers,
              accountants and auditors;
            </li>
            <li>
              <strong>regulators, law enforcement or government bodies</strong>{" "}
              where required or authorised by law;
            </li>
            <li>
              a <strong>successor entity</strong> in connection with a sale,
              merger or restructure of our business;
            </li>
            <li>
              <strong>other parties with your consent</strong>.
            </li>
          </Letters>
          <p>
            We require our service providers to handle personal information
            consistently with this Policy and applicable law. We do not sell
            your personal information.
          </p>
        </Section>

        <Section title="6. Overseas disclosure (APP 8)">
          <p>
            Some of our service providers (for example, payment processing,
            cloud hosting, and analytics) may store or process personal
            information <strong>outside Australia</strong>. The countries in
            which recipients are likely to be located include the United
            States, the European Union, and other countries where our
            providers operate.
          </p>
          <p>
            Before disclosing personal information overseas, we take
            reasonable steps to ensure recipients handle it consistently with
            the APPs, or we rely on an applicable exception under the Privacy
            Act.
          </p>
        </Section>

        <Section title="7. Security and retention">
          <Numbered n="7.1">
            We take reasonable steps to protect personal information from
            misuse, interference, loss, and unauthorised access, modification
            or disclosure, including access controls, encryption in transit,
            and security monitoring.
          </Numbered>
          <Numbered n="7.2">
            We retain personal information only for as long as necessary for
            the purposes described in this Policy or as required by law, after
            which we take reasonable steps to destroy or de-identify it.
          </Numbered>
        </Section>

        <Section title="8. Direct marketing and your choices (APP 7 and the Spam Act)">
          <Numbered n="8.1">
            We may send you marketing communications about the Service where
            permitted by law.
          </Numbered>
          <Numbered n="8.2">
            You can <strong>opt out</strong> at any time by using the
            unsubscribe link in our messages or by contacting us at <Email />.
            We will action opt-out requests within a reasonable time.
          </Numbered>
          <Numbered n="8.3">
            We handle electronic marketing in accordance with the{" "}
            <em>Spam Act 2003</em> (Cth).
          </Numbered>
        </Section>

        <Section title="9. Access and correction (APP 12 and 13)">
          <Numbered n="9.1">
            You may request access to the personal information we hold about
            you and ask us to correct it if it is inaccurate, out of date,
            incomplete, irrelevant or misleading.
          </Numbered>
          <Numbered n="9.2">
            To make a request, contact us at <Email />. We will respond within
            a reasonable period. We may need to verify your identity first. If
            we refuse access or correction, we will tell you why and how to
            complain, except where the law provides otherwise.
          </Numbered>
        </Section>

        <Section title="10. Additional rights for users in the EU/EEA, UK and California">
          <p>
            This Section applies in addition to the rest of this Policy where
            the relevant laws apply to you.
          </p>
          <p>
            <strong>
              (A) European Economic Area and United Kingdom (GDPR / UK GDPR).
            </strong>{" "}
            If you are located in the EEA or the UK, we process your personal
            data on one or more of the following legal bases: performance of
            our contract with you (to provide the Service); your consent (for
            example, certain marketing or cookies); our legitimate interests
            (such as security, fraud prevention and improving the Service);
            and compliance with our legal obligations. You have the right to
            access your personal data; request its correction or erasure;
            restrict or object to its processing; request data portability;
            and withdraw consent at any time. You may also lodge a complaint
            with your local data protection authority (in the UK, the
            Information Commissioner&rsquo;s Office). To exercise these
            rights, contact us at <Email />.
          </p>
          <p>
            <strong>(B) California (CCPA/CPRA).</strong> If you are a
            California resident, you have the right to know what personal
            information we collect, use and disclose; to request access to and
            deletion of your personal information; to correct inaccurate
            personal information; and not to be discriminated against for
            exercising these rights. We do not sell your personal
            information, and we do not &ldquo;share&rdquo; it for
            cross-context behavioural advertising, as those terms are defined
            under California law. To exercise your rights, contact us at{" "}
            <Email />. You may use an authorised agent to submit a request on
            your behalf.
          </p>
        </Section>

        <Section title="11. Children">
          <p>
            The Service is intended for adults aged 18 and over. We do not
            knowingly collect personal information from anyone under 18. If we
            become aware that we have collected such information, we will take
            reasonable steps to delete it.
          </p>
        </Section>

        <Section title="12. Third-party links and services">
          <p>
            The Service may contain links to, or integrate with, third-party
            websites and services (including payment providers). Their privacy
            practices are governed by their own policies, and we are not
            responsible for them. We encourage you to review their policies.
          </p>
        </Section>

        <Section title="13. Data breaches">
          <p>
            We comply with the Notifiable Data Breaches (NDB) scheme under the{" "}
            <em>Privacy Act 1988</em> (Cth). If we become aware of an eligible
            data breach likely to result in serious harm, we will notify
            affected individuals and the Office of the Australian Information
            Commissioner (OAIC) as required by law.
          </p>
        </Section>

        <Section title="14. How to make a complaint">
          <Numbered n="14.1">
            If you have a privacy concern or complaint, contact our Privacy
            Officer at <Email /> with details. We will acknowledge and
            investigate your complaint and respond within a reasonable time.
          </Numbered>
          <Numbered n="14.2">
            If you are not satisfied with our response, you may contact the{" "}
            <strong>
              Office of the Australian Information Commissioner (OAIC)
            </strong>
            :<br />
            Website:{" "}
            <a
              href="https://www.oaic.gov.au"
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2 hover:text-primary"
            >
              www.oaic.gov.au
            </a>{" "}
            &mdash; Phone: 1300 363 992
          </Numbered>
        </Section>

        <Section title="15. Changes to this Policy">
          <p>
            We may update this Privacy Policy from time to time. The current
            version will always be available on the Service, and material
            changes will be notified where reasonable. The &ldquo;Last
            updated&rdquo; date indicates when it was last revised.
          </p>
        </Section>

        <Section title="16. Contact us">
          <p>
            <strong>Liverush</strong>
            <br />
            Privacy Officer
            <br />
            Victoria, Australia
            <br />
            Email: <Email />
          </p>
        </Section>
      </article>
    </PageContainer>
  );
}

// =========================================================================
// Tiny presentational helpers — local to this file to keep the legal
// document self-contained. Mirror the helpers in Terms.tsx; if a third
// legal page lands later, lift them out into a shared LegalLayout.
// =========================================================================

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 pt-2">
      <h2 className="font-heading text-lg font-bold text-foreground sm:text-xl">
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Numbered({
  n,
  children,
}: {
  n: string;
  children: React.ReactNode;
}) {
  return (
    <p>
      <span className="font-semibold text-foreground">{n}</span> {children}
    </p>
  );
}

function Letters({ children }: { children: React.ReactNode }) {
  return (
    <ol className="ml-5 list-[lower-alpha] space-y-1.5 pt-1">{children}</ol>
  );
}

function Email() {
  return (
    <a
      href="mailto:support@liverush.co"
      className="underline underline-offset-2 hover:text-primary"
    >
      support@liverush.co
    </a>
  );
}
