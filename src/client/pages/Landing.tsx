import { Hero } from '@client/components/landing/hero';
import { CTA } from '@client/components/landing/cta';
import { Footer } from '@client/components/landing/footer';
import { TopNav } from '@client/components/landing/top-nav';
import { 
  ShieldCheck, 
  Code2, 
  Layers, 
  Bot, 
} from 'lucide-react';

export function LandingPage() {
  return (
    <div className="min-h-screen bg-background selection:bg-primary/20 overflow-x-hidden pt-16">
      <TopNav />
      
      <main>
        <Hero />
        
        {/* Technical Architecture Strip */}
        <section id="features" className="pt-16 pb-16 border-b border-border/40">
          <div className="container mx-auto px-6">
            <div className="flex flex-col gap-12">
              
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
                <div className="lg:col-span-4">

                  <h2 className="text-3xl font-black tracking-tight text-foreground leading-none mb-5">
                    A SENTIENT <br/><span className="text-primary italic">PEER LEARNER.</span>
                  </h2>
                  <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
                    Codra builds high-dimensional graphs of your repository to understand architectural intent, not just syntax tokens.
                  </p>
                </div>

                <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-px bg-border/40 border border-border/40 overflow-hidden rounded-2xl">
                  {[
                    { icon: ShieldCheck, title: 'In-depth Security', desc: 'Identifies P0 vulnerabilities, credential leaks, and insecure logic flows.' },
                    { icon: Layers, title: 'Architectural Context', desc: 'Validates changes against your domain-driven design and structural rules.' },
                    { icon: Bot, title: 'Autonomous Feedback', desc: 'Predictive suggestions that get smarter as your codebase evolves.' },
                    { icon: Code2, title: 'OSS Native', desc: 'Built by developers for the open-source community, 100% transparent.' }
                  ].map((item, i) => (
                    <div key={i} className="bg-background p-7 hover:bg-secondary/20 transition-colors group">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-primary mb-5 group-hover:scale-110 transition-transform">
                        <item.icon size={18} />
                      </div>
                      <h4 className="text-sm font-bold text-foreground mb-1.5">{item.title}</h4>
                      <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
                    </div>
                  ))}
                </div>
              </div>



            </div>
          </div>
        </section>

        <CTA />
      </main>

      <Footer />
    </div>
  );
}
