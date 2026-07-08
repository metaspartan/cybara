import { SectionHeading } from "./SectionHeading.tsx";
import { FAQS } from "../data/content.ts";

export function Faq(): React.ReactElement {
  return (
    <section className="section" id="faq">
      <SectionHeading
        eyebrow="Questions"
        title="Frequently asked"
        description="The essentials about what Cybara is, where it runs, and how it stays under your control."
      />
      <div className="faq-list">
        {FAQS.map((faq) => (
          <details className="glass faq-item" key={faq.question}>
            <summary className="faq-question">
              <span>{faq.question}</span>
              <span className="faq-marker" aria-hidden="true" />
            </summary>
            <p className="faq-answer">{faq.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
