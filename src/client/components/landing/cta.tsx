import { Link } from 'react-router-dom';
import { Button } from '@client/components/ui/button';
import { ArrowRight } from 'lucide-react';

export function CTA() {
  return (
    <section className="pt-0 pb-16">
      <div className="container mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center border-t border-border/60 pt-14">

          {/* Left: raw, editorial heading */}
          <div className="lg:col-span-7">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary mb-4">
              Open Source · MIT License
            </p>
            <h2 className="text-3xl lg:text-4xl font-black tracking-tight text-foreground leading-[0.9] mb-0"
              style={{ letterSpacing: '-0.03em' }}>
              IT'S YOUR CODE.<br />
              <span className="text-muted-foreground/50">OWN THE REVIEWER TOO.</span>
            </h2>
          </div>

          {/* Right: actions + social proof */}
          <div className="lg:col-span-5 flex flex-col gap-5">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Codra runs on your infrastructure. No vendor lock-in, no usage caps, no black box. Ship it alongside your stack.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link to="/login">
                <Button size="lg" className="h-11 px-7 text-sm font-black gap-2 transition-all hover:scale-[1.03] active:scale-95 whitespace-nowrap">
                  Deploy to your Org <ArrowRight size={15} strokeWidth={3} />
                </Button>
              </Link>
              <a href="https://github.com/devarshishimpi/codra" target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="lg" className="h-11 px-6 text-sm font-semibold whitespace-nowrap">
                  Read the Docs
                </Button>
              </a>
            </div>
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/40">
              Cloudflare-ready · Self-hosted · Community maintained
            </p>
          </div>

        </div>
      </div>
    </section>
  );
}
