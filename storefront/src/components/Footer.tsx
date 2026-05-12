import { Link } from "react-router-dom";

export default function Footer() {
  return (
    <footer className="mt-32 border-t border-ink/10 bg-sand text-ink">
      <div className="container-x py-16">
        <div className="grid gap-12 md:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-maroon-700 font-display text-lg font-bold text-cream">
                G
              </span>
              <span className="font-display text-xl font-semibold tracking-tightest">
                GIKI Mart
              </span>
            </div>
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-ink-soft">
              A storefront that stays up. Built on AWS Fargate behind an
              Application Load Balancer, auto-scaling under load and surviving
              chaos experiments without dropping a request.
            </p>
          </div>

          <div>
            <h4 className="text-xs uppercase tracking-[0.2em] text-ink-muted">
              Explore
            </h4>
            <ul className="mt-5 space-y-3 text-sm text-ink-soft">
              <li>
                <Link to="/" className="link-underline">
                  Home
                </Link>
              </li>
              <li>
                <Link to="/shop" className="link-underline">
                  Shop
                </Link>
              </li>
              <li>
                <Link to="/about" className="link-underline">
                  Architecture
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs uppercase tracking-[0.2em] text-ink-muted">
              Project
            </h4>
            <ul className="mt-5 space-y-3 text-sm text-ink-soft">
              <li>CE-408 · Cloud Computing</li>
              <li>GIK Institute · 8th Semester</li>
              <li className="font-mono text-xs text-ink-muted">
                Fargate · ALB · RDS · DynamoDB · SQS
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-2 border-t border-ink/10 pt-6 text-xs text-ink-muted sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} GIKI Mart · CE-408 demo storefront.</span>
          <span className="font-mono">Auto-scaling · Chaos-tested · Zero 5xx</span>
        </div>
      </div>
    </footer>
  );
}
