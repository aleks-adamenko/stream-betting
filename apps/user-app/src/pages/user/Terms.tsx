import { PageContainer } from "@/components/layout/PageContainer";

/**
 * Terms of Service — Australian-law document covering account use, the
 * Rush Coin virtual currency, gameplay, prohibited conduct, content rules,
 * moderation, ACL carve-outs, and dispute resolution.
 *
 * Source: legal draft template adapted on operator request. Substitutions
 * applied:
 *   • Company name → "Liverush" (no Pty Ltd, no ABN/ACN)
 *   • Address fields → removed
 *   • Governing state → Victoria
 *   • Contact email → support@liverush.co
 *
 * Layout mirrors the Privacy page so the two reads stay consistent.
 */
export default function Terms() {
  return (
    <PageContainer className="lg:pt-12">
      <article className="mx-auto w-full max-w-3xl space-y-6 text-sm leading-relaxed text-foreground/85 sm:text-base">
        <header className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
            Legal
          </p>
          <h1 className="font-heading text-3xl font-bold text-foreground sm:text-4xl">
            Terms of Service
          </h1>
          <p className="text-sm text-muted-foreground">
            Last updated: 4 June 2026
          </p>
        </header>

        <p>
          These Terms of Service (&ldquo;<strong>Terms</strong>&rdquo;) govern
          your access to and use of the Liverush platform, including our
          website, applications and related services (together, the
          &ldquo;<strong>Service</strong>&rdquo;). The Service is operated by{" "}
          <strong>Liverush</strong> (&ldquo;<strong>Liverush</strong>&rdquo;,
          &ldquo;<strong>we</strong>&rdquo;, &ldquo;<strong>us</strong>&rdquo;,
          &ldquo;<strong>our</strong>&rdquo;).
        </p>

        <p>
          By creating an account, purchasing Rush Coins, or otherwise using
          the Service, you agree to these Terms. If you do not agree, do not
          use the Service.
        </p>

        <Section title="1. About the Service — important nature notice">
          <Numbered n="1.1">
            Liverush is an online entertainment and social gaming platform.
            Creators host live, interactive challenges, and users may use a
            virtual, on-platform currency called Rush Coins
            (&ldquo;<strong>RC</strong>&rdquo;) to make in-app predictions
            on the outcome of those challenges for entertainment purposes
            only.
          </Numbered>
          <Numbered n="1.2">
            Rush Coins are a virtual, in-app entertainment feature and:
            <Letters>
              <li>have no monetary or real-world value;</li>
              <li>
                cannot be withdrawn, cashed out, redeemed, exchanged, sold or
                transferred for money, cryptocurrency, goods, or anything of
                value, whether on or off the platform;
              </li>
              <li>
                are licensed to you for use only within the Service.
              </li>
            </Letters>
          </Numbered>
          <Numbered n="1.3">
            Because no prize, winning or payout of monetary value is offered
            or payable through gameplay, and Rush Coins cannot be exchanged
            for anything of value, the Service does not constitute gambling.
            Any Rush Coins obtained through gameplay can only be used to
            continue accessing entertainment features and have no cash
            value.
          </Numbered>
          <Numbered n="1.4">
            The Service does not offer, and you cannot access through it,
            any real-money gaming, wagering or gambling service of the kind
            regulated under the <em>Interactive Gambling Act 2001</em> (Cth)
            or comparable State or Territory legislation.
          </Numbered>
        </Section>

        <Section title="2. Eligibility">
          <Numbered n="2.1">
            The Service is intended <strong>for adults aged 18 years or
            older</strong>. By using the Service you represent and warrant
            that you are at least 18.
          </Numbered>
          <Numbered n="2.2">
            You must have the legal capacity to enter into a binding contract
            and must not be barred from using the Service under any applicable
            law.
          </Numbered>
          <Numbered n="2.3">
            We may require verification of your identity or age at any time
            and may suspend or close accounts that we reasonably believe
            belong to minors or ineligible persons.
          </Numbered>
          <Numbered n="2.4">
            You are responsible for ensuring that your use of the Service is
            lawful in your jurisdiction.
          </Numbered>
        </Section>

        <Section title="3. International use and territorial restrictions">
          <Numbered n="3.1">
            The Service is operated from Australia. We make no representation
            that the Service, or any of its features, is appropriate, lawful
            or available for use in any particular country or location.
          </Numbered>
          <Numbered n="3.2">
            You must not use the Service if your use of it, or of its
            virtual-currency prediction or social-gaming features, is
            prohibited or restricted under the laws that apply to you (this
            is in addition to your responsibility under clause 2.4).
          </Numbered>
          <Numbered n="3.3">
            We may, at our discretion and without notice, restrict, geo-block
            or refuse access to the Service (in whole or in part) in any
            territory, and may verify your location for this purpose,
            including where we consider it necessary to comply with
            applicable law or to manage legal or regulatory risk.
          </Numbered>
        </Section>

        <Section title="4. Accounts and security">
          <Numbered n="4.1">
            You must provide accurate, current and complete information when
            registering and keep it up to date.
          </Numbered>
          <Numbered n="4.2">
            You are responsible for safeguarding your login credentials and
            for all activity that occurs under your account.
          </Numbered>
          <Numbered n="4.3">
            You must notify us promptly of any unauthorised use of your
            account. We are not liable for losses arising from your failure to
            keep your credentials secure, except to the extent caused by us.
          </Numbered>
          <Numbered n="4.4">
            You may hold only <strong>one account</strong> unless we expressly
            permit otherwise.
          </Numbered>
        </Section>

        <Section title="5. Rush Coins (virtual currency)">
          <Numbered n="5.1">
            <strong>Limited licence, not property.</strong> Rush Coins are a
            limited, personal, revocable, non-transferable licence to access
            entertainment features of the Service. You do not own Rush Coins
            and they are not your property, securities, e-money, stored value,
            or a financial product.
          </Numbered>
          <Numbered n="5.2">
            <strong>No monetary value and no cash-out.</strong> As stated in
            Section 1, Rush Coins have no monetary value and can never be
            redeemed, withdrawn, refunded as cash, transferred or exchanged
            for money or anything of value. We do not provide any mechanism to
            convert Rush Coins into money or cryptocurrency.
          </Numbered>
          <Numbered n="5.3">
            <strong>Purchases.</strong> You may purchase Rush Coins through
            the payment methods we make available. Prices are displayed at the
            point of purchase and may change at any time. You authorise us and
            our payment providers to charge your selected payment method.
          </Numbered>
          <Numbered n="5.4">
            <strong>Nature of purchase.</strong> When you purchase Rush Coins
            you are purchasing a <strong>licence to use an entertainment
            feature</strong>, not buying a tradeable or redeemable asset.
          </Numbered>
          <Numbered n="5.5">
            <strong>No refunds (subject to law).</strong> All purchases are
            final and non-refundable, <strong>except where a refund is
            required under the Australian Consumer Law or other applicable
            law that cannot be excluded</strong> (see Section 16).
          </Numbered>
          <Numbered n="5.6">
            <strong>Changes, expiry and forfeiture.</strong> We may modify,
            manage, regulate, expire, or remove Rush Coins, and adjust their
            availability, pricing or features, at our discretion. We may
            forfeit or remove Rush Coins associated with conduct that breaches
            these Terms. Rush Coins may be forfeited without compensation if
            your account is closed.
          </Numbered>
          <Numbered n="5.7">
            Rush Coins are made available only by us as the operator of the
            Service.
          </Numbered>
        </Section>

        <Section title="6. Challenges, predictions and gameplay">
          <Numbered n="6.1">
            Users may use Rush Coins to make predictions on the outcomes of
            challenges hosted on the Service, for entertainment only.
          </Numbered>
          <Numbered n="6.2">
            Outcomes, odds and pool mechanics are determined by the rules of
            each challenge as displayed in the Service. We may apply a
            platform fee and creator allocation expressed in Rush Coins; these
            are internal to the Service and have no monetary value.
          </Numbered>
          <Numbered n="6.3">
            We may void, cancel, re-run, or reverse any challenge or
            prediction, and return associated Rush Coins, where we reasonably
            consider there has been an error, technical fault, suspected
            manipulation, or breach of these Terms.
          </Numbered>
          <Numbered n="6.4">
            We do not guarantee the availability, timing, fairness as between
            participants, or continuity of any challenge.
          </Numbered>
        </Section>

        <Section title="7. Creator content and conduct">
          <Numbered n="7.1">
            Challenges and live content are created and hosted by users acting
            as creators (&ldquo;<strong>Creators</strong>&rdquo;). Creators
            are independent and are not employees or agents of Liverush.
          </Numbered>
          <Numbered n="7.2">
            You acknowledge that Creator content is user-generated. We do not
            endorse, and are not responsible for, the conduct, statements, or
            content of Creators or other users, except as required by law.
          </Numbered>
          <Numbered n="7.3">
            By submitting content to the Service, you grant us a non-exclusive,
            worldwide, royalty-free licence to host, store, reproduce, display
            and distribute that content for the purpose of operating and
            promoting the Service.
          </Numbered>
          <Numbered n="7.4">
            You must hold all rights necessary to submit your content and must
            not submit content that is unlawful, infringing, harmful, or in
            breach of Section 8 or Section 9.
          </Numbered>
        </Section>

        <Section title="8. Prohibited conduct">
          <p>You must not:</p>
          <Letters>
            <li>use the Service if under 18 or otherwise ineligible;</li>
            <li>
              cheat, manipulate outcomes, collude with Creators or other users,
              or arrange or participate in match-fixing;
            </li>
            <li>
              operate multiple or fake accounts, or use automated tools, bots
              or scripts;
            </li>
            <li>
              attempt to convert, sell, transfer or trade Rush Coins for money
              or value, on or off platform;
            </li>
            <li>
              use the Service for money laundering, fraud, or any unlawful
              purpose;
            </li>
            <li>
              interfere with, probe, or attempt to gain unauthorised access to
              the Service or its security;
            </li>
            <li>harass, abuse, defraud or harm other users or Creators;</li>
            <li>
              infringe our or any third party&rsquo;s intellectual property or
              other rights;
            </li>
            <li>misrepresent your identity, age or location.</li>
          </Letters>
          <p>
            We may investigate suspected breaches and cooperate with
            authorities.
          </p>
        </Section>

        <Section title="9. Prohibited content (streaming, broadcasts and uploads)">
          <Numbered n="9.1">
            This Section applies to all content you stream, broadcast, upload,
            display or otherwise make available through the Service
            (&ldquo;<strong>Content</strong>&rdquo;), including challenges
            hosted by Creators. You are solely responsible for your Content.
          </Numbered>
          <Numbered n="9.2">
            You must not create, stream, upload, transmit or share any
            Content that:
            <Letters>
              <li>
                is pornographic, sexually explicit, or depicts nudity or
                sexual acts, or that offers or solicits sexual services;
              </li>
              <li>
                sexualises, exploits, endangers or otherwise involves a
                person under 18 in any way. Child sexual abuse material is
                strictly and absolutely prohibited and is subject to clause
                9.4;
              </li>
              <li>
                depicts, promotes, incites or glorifies terrorism or violent
                extremism, or that supports, recruits for, or distributes
                propaganda on behalf of a terrorist or extremist organisation;
              </li>
              <li>
                constitutes abhorrent violent material (including material
                depicting terrorist acts, murder, attempted murder, torture,
                rape or kidnapping), or that is gratuitously violent,
                graphic, or depicts serious harm to people or animals;
              </li>
              <li>
                promotes, incites or threatens violence, or that promotes,
                organises or glorifies harm against any person or group;
              </li>
              <li>
                promotes hatred, vilification or discrimination against a
                person or group on the basis of race, ethnicity, national
                origin, religion, disability, sex, sexual orientation, gender
                identity, age or any other protected attribute;
              </li>
              <li>
                promotes, depicts or provides instructions for self-harm,
                suicide or disordered eating;
              </li>
              <li>
                offers, sells, promotes or provides instructions for weapons,
                firearms, ammunition, explosives, or other dangerous goods;
              </li>
              <li>
                offers, sells, promotes, or facilitates the supply or use of
                illicit drugs or controlled substances;
              </li>
              <li>
                is otherwise unlawful, or promotes, facilitates or provides
                instructions for any illegal activity, fraud or scam;
              </li>
              <li>
                depicts or encourages dangerous acts reasonably likely to
                cause death, injury or serious harm;
              </li>
              <li>
                discloses another person&rsquo;s private or identifying
                information without consent (&ldquo;doxxing&rdquo;), or
                shares intimate images of a person without their consent;
              </li>
              <li>
                impersonates any person or entity, or is deceptive or
                misleading in a way likely to cause harm;
              </li>
              <li>
                infringes the intellectual property, privacy or other rights
                of any third party, including broadcasting content you are
                not authorised to broadcast.
              </li>
            </Letters>
          </Numbered>
          <Numbered n="9.3">
            You must comply with all applicable content classification and
            online safety laws, including the{" "}
            <em>Online Safety Act 2021</em> (Cth), and with any directions
            of the eSafety Commissioner.
          </Numbered>
          <Numbered n="9.4">
            <strong>Zero tolerance — child safety.</strong> We have zero
            tolerance for any content that sexualises or exploits minors.
            Any such content will result in immediate and permanent
            termination of your account under Section 13, preservation of
            relevant records, and reporting to law enforcement and the
            relevant authorities (including, in Australia, the Australian
            Centre to Counter Child Exploitation and/or the eSafety
            Commissioner), as required or permitted by law.
          </Numbered>
        </Section>

        <Section title="10. Community standards (chat, comments, messages and usernames)">
          <Numbered n="10.1">
            The Service includes chat, comments, direct messages and other
            interactive features. These standards apply to all your
            communications and to your username, avatar and profile.
          </Numbered>
          <Numbered n="10.2">
            You must not, in any communication on the Service:
            <Letters>
              <li>
                harass, bully, threaten, intimidate, stalk or abuse any
                person;
              </li>
              <li>
                use hate speech, slurs, or content that vilifies or
                discriminates against a person or group on the basis of a
                protected attribute (as listed in clause 9.2(f));
              </li>
              <li>
                send sexual or sexually suggestive messages that are
                unwanted, or any sexual content directed at or involving a
                person under 18, or attempt to groom, lure or solicit a
                minor;
              </li>
              <li>
                make credible threats of violence or encourage others to
                harm themselves or others;
              </li>
              <li>
                publish or share another person&rsquo;s private or
                identifying information without consent;
              </li>
              <li>
                post spam, scams, phishing, chain messages, or unsolicited
                advertising or solicitation;
              </li>
              <li>
                share, link to, or distribute any content prohibited under
                Section 9;
              </li>
              <li>
                use chat to arrange, coordinate or facilitate cheating,
                collusion, match-fixing or other conduct prohibited under
                Section 8;
              </li>
              <li>
                impersonate any person, including our staff or moderators;
              </li>
              <li>
                choose or use a username, avatar or profile content that is
                offensive, deceptive, infringing, or otherwise in breach of
                these Terms.
              </li>
            </Letters>
          </Numbered>
          <Numbered n="10.3">
            You must comply with the reasonable directions of our
            moderators. Moderators may remove messages, mute, restrict or
            report any user in accordance with Section 11.
          </Numbered>
        </Section>

        <Section title="11. Reporting, moderation and enforcement">
          <Numbered n="11.1">
            <strong>Reporting.</strong> If you encounter Content or conduct
            that breaches these Terms, you can report it to us at <Email />{" "}
            or through the in-Service reporting tools. We review reports and
            act on them at our discretion.
          </Numbered>
          <Numbered n="11.2">
            <strong>Our rights.</strong> We may, but are not obliged to,
            monitor, review, screen, moderate or remove any Content or
            communication. We may act on suspected breaches without prior
            notice where reasonable.
          </Numbered>
          <Numbered n="11.3">
            <strong>Consequences.</strong> Where we reasonably determine
            that you have breached Section 8, 9 or 10, we may take any one
            or more of the following actions, proportionate to the breach:
            <Letters>
              <li>issue a warning;</li>
              <li>remove or restrict the relevant Content or messages;</li>
              <li>
                mute, limit or suspend access to chat or other features;
              </li>
              <li>suspend your account temporarily;</li>
              <li>
                permanently ban you and terminate your account under Section
                13;
              </li>
              <li>
                forfeit any Rush Coins associated with your account, without
                compensation (consistent with clause 5.6);
              </li>
              <li>
                withhold or reverse any creator allocations connected to the
                breaching activity.
              </li>
            </Letters>
          </Numbered>
          <Numbered n="11.4">
            <strong>Serious breaches.</strong> For serious breaches —
            including child sexual abuse material, terrorist or violent
            extremist content, abhorrent violent material, or credible
            threats of violence — we will impose an immediate and permanent
            ban, preserve relevant evidence, and report to law enforcement
            and relevant regulators, and we will cooperate with their
            investigations, as required or permitted by law.
          </Numbered>
          <Numbered n="11.5">
            <strong>No compensation.</strong> We are not liable to you, and
            you are not entitled to any refund or compensation (including
            for any Rush Coins), where action is taken against your account
            for a breach of these Terms, except to the extent required by
            the Australian Consumer Law (see Section 16).
          </Numbered>
          <Numbered n="11.6">
            <strong>Appeals.</strong> If you believe enforcement action was
            taken in error, you may contact us at <Email /> to request a
            review. We will consider genuine appeals in good faith but are
            not obliged to reverse a decision.
          </Numbered>
        </Section>

        <Section title="12. Healthy play">
          <Numbered n="12.1">
            The Service is intended for entertainment only. We encourage you
            to use it in a balanced way and to take regular breaks.
          </Numbered>
          <Numbered n="12.2">
            Rush Coins have no monetary value and cannot be cashed out (see
            Section 5). Any purchases you make are for in-app entertainment
            only. You should only ever spend what you are comfortable
            spending on entertainment.
          </Numbered>
          <Numbered n="12.3">
            You can stop using the Service at any time, and you can close
            your account at any time as described in Section 13.
          </Numbered>
          <Numbered n="12.4">
            If you feel your use of the Service is becoming excessive or is
            affecting your wellbeing, we encourage you to take a break and,
            if you wish, to speak with someone you trust or a qualified
            health professional. You can also contact us at <Email /> for
            assistance with your account.
          </Numbered>
        </Section>

        <Section title="13. Suspension and termination">
          <Numbered n="13.1">
            We may suspend, restrict or terminate your access to the Service,
            and remove or forfeit Rush Coins, where we reasonably believe you
            have breached these Terms or applicable law, or to protect the
            Service, other users, or us.
          </Numbered>
          <Numbered n="13.2">
            You may close your account at any time. On closure, any remaining
            Rush Coins are forfeited and have no monetary value.
          </Numbered>
          <Numbered n="13.3">
            Clauses intended by their nature to survive termination
            (including Sections 1, 5, 8, 9, 10, 11 and 14–19) survive.
          </Numbered>
        </Section>

        <Section title="14. Intellectual property">
          <Numbered n="14.1">
            The Service and all associated content, trademarks, and software
            (other than user-generated content) are owned by or licensed to us
            and are protected by law.
          </Numbered>
          <Numbered n="14.2">
            We grant you a limited, revocable, non-exclusive, non-transferable
            licence to use the Service for personal, non-commercial
            entertainment in accordance with these Terms.
          </Numbered>
        </Section>

        <Section title="15. Disclaimers">
          <Numbered n="15.1">
            To the maximum extent permitted by law, the Service is provided
            &ldquo;<strong>as is</strong>&rdquo; and &ldquo;<strong>as
            available</strong>&rdquo;, and we make no warranties that it will
            be uninterrupted, error-free, or secure.
          </Numbered>
          <Numbered n="15.2">Section 15 is subject to Section 16.</Numbered>
        </Section>

        <Section title="16. Australian Consumer Law and other non-excludable rights">
          <Numbered n="16.1">
            Our goods and services come with guarantees that <strong>cannot
            be excluded under the Australian Consumer Law (ACL)</strong>{" "}
            (Schedule 2 to the <em>Competition and Consumer Act 2010</em>{" "}
            (Cth)).
          </Numbered>
          <Numbered n="16.2">
            <strong>Nothing in these Terms excludes, restricts or
            modifies</strong> any consumer guarantee, right or remedy
            conferred on you by the ACL or any other applicable law that
            cannot lawfully be excluded or limited.
          </Numbered>
          <Numbered n="16.3">
            To the extent we are permitted to limit our liability for a
            failure to comply with a consumer guarantee, our liability is
            limited, at our option, to: (a) re-supplying the relevant
            services; or (b) paying the cost of having the relevant services
            re-supplied.
          </Numbered>
        </Section>

        <Section title="17. Limitation of liability">
          <Numbered n="17.1">
            <strong>Subject to Section 16</strong>, and to the maximum extent
            permitted by law, we are not liable for any indirect, incidental,
            special or consequential loss, or for loss of profits, data, or
            goodwill, arising from your use of the Service.
          </Numbered>
          <Numbered n="17.2">
            <strong>Subject to Section 16</strong>, our total aggregate
            liability arising out of or in connection with the Service is
            limited to the total amount you paid to us for Rush Coins in the{" "}
            <strong>three (3) months</strong> preceding the event giving rise
            to the liability.
          </Numbered>
        </Section>

        <Section title="18. Indemnity">
          <p>
            To the extent permitted by law, you agree to indemnify us against
            claims, losses and costs arising from your breach of these Terms,
            your content, or your unlawful or unauthorised use of the Service.
          </p>
        </Section>

        <Section title="19. Changes to the Service and these Terms">
          <Numbered n="19.1">
            We may modify the Service or these Terms at any time. Material
            changes will be notified through the Service or by email where
            reasonable.
          </Numbered>
          <Numbered n="19.2">
            Your continued use after changes take effect constitutes
            acceptance. If you do not agree, you must stop using the Service.
          </Numbered>
        </Section>

        <Section title="20. Privacy">
          <p>
            Your use of the Service is also governed by our{" "}
            <a
              href="/privacy"
              className="underline underline-offset-2 hover:text-primary"
            >
              Privacy Policy
            </a>
            , which explains how we handle your personal information in
            accordance with the <em>Privacy Act 1988</em> (Cth).
          </p>
        </Section>

        <Section title="21. Governing law and jurisdiction">
          <Numbered n="21.1">
            These Terms are governed by the laws of{" "}
            <strong>Victoria, Australia</strong>.
          </Numbered>
          <Numbered n="21.2">
            You and we submit to the non-exclusive jurisdiction of the courts
            of <strong>Victoria</strong> and the Commonwealth of Australia.
          </Numbered>
        </Section>

        <Section title="22. Complaints and dispute resolution">
          <Numbered n="22.1">
            If you have a complaint, contact us first at <Email /> so we can
            try to resolve it.
          </Numbered>
          <Numbered n="22.2">
            Nothing in this Section limits your rights under the Australian
            Consumer Law or to approach a relevant regulator or tribunal.
          </Numbered>
        </Section>

        <Section title="23. General">
          <Numbered n="23.1">
            <strong>Severability.</strong> If any provision is unenforceable,
            the remaining provisions continue in effect.
          </Numbered>
          <Numbered n="23.2">
            <strong>No waiver.</strong> Failure to enforce a provision is not
            a waiver of it.
          </Numbered>
          <Numbered n="23.3">
            <strong>Assignment.</strong> You may not assign these Terms
            without our consent. We may assign them to a successor.
          </Numbered>
          <Numbered n="23.4">
            <strong>Entire agreement.</strong> These Terms and the Privacy
            Policy are the entire agreement between you and us regarding the
            Service.
          </Numbered>
        </Section>

        <Section title="24. Contact">
          <p>
            <strong>Liverush</strong>
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
// Tiny presentational helpers — kept local to keep the long document file
// self-contained. If a third legal page lands later, lift these out to a
// shared `LegalLayout` component.
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
