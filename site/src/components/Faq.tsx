import { SectionHeading } from "./SectionHeading";
import { FAQS } from "../content";

export function Faq(): React.ReactElement {
  return (
    <section className="section" id="faq">
      <SectionHeading
        eyebrow="Questions"
        title="Frequently asked"
        description="What Cybara is, where it runs, which providers and channels it supports, how it protects your keys and data, and how it stays under your control."
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
