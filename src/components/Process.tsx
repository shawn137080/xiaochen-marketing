"use client";

import { motion } from "framer-motion";
import { useRef } from "react";
import { useInView } from "framer-motion";

const steps = [
  {
    number: "01",
    title: "Discovery Call",
    description:
      "We hop on a quick call to understand your business, goals, target audience, and what you need from your website. No jargon, no pressure.",
    color: "from-amber-400 to-amber-500",
  },
  {
    number: "02",
    title: "Design & Strategy",
    description:
      "We create a wireframe and visual design tailored to your brand. You review, give feedback, and we refine until it's perfect — usually in 24 hours.",
    color: "from-amber-500 to-orange-500",
  },
  {
    number: "03",
    title: "Development & Build",
    description:
      "Using modern frameworks and AI-assisted tooling, we build your site fast. Every page is responsive, performance-optimized, and thoroughly tested.",
    color: "from-orange-500 to-orange-600",
  },
  {
    number: "04",
    title: "Launch & Thrive",
    description:
      "We deploy your site, set up analytics, and hand over everything you need. Ongoing maintenance and updates available so you never have to worry.",
    color: "from-orange-600 to-red-600",
  },
];

function StepCard({ step, index }: { step: typeof steps[0]; index: number }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, x: index % 2 === 0 ? -30 : 30 }}
      animate={isInView ? { opacity: 1, x: 0 } : {}}
      transition={{ duration: 0.5, delay: index * 0.15 }}
      className="relative flex items-start gap-6 sm:gap-8 pb-12 last:pb-0"
    >
      {/* Number + connector */}
      <div className="flex flex-col items-center">
        <div
          className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br ${step.color} flex items-center justify-center text-white font-bold text-lg sm:text-xl shadow-lg shrink-0`}
        >
          {step.number}
        </div>
        {index < steps.length - 1 && (
          <div className="w-0.5 h-full mt-2 bg-gradient-to-b from-amber-400/40 to-transparent" />
        )}
      </div>

      {/* Content */}
      <div className="pt-2 sm:pt-3">
        <h3 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white mb-2">
          {step.title}
        </h3>
        <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 leading-relaxed max-w-lg">
          {step.description}
        </p>
      </div>
    </motion.div>
  );
}

export default function Process() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <section id="process" className="relative py-20 sm:py-28 lg:py-32">
      {/* Background */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-[0.03]"
        style={{ backgroundImage: "url('/images/process-bg.jpg')" }}
      />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center" ref={ref}>
          {/* Left: Section text */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5 }}
          >
            <span className="inline-block text-xs sm:text-sm font-semibold text-amber-500 uppercase tracking-[0.2em] mb-4">
              How We Work
            </span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 dark:text-white mb-6">
              From Idea to Launch in{" "}
              <span className="gradient-text">Days, Not Months</span>
            </h2>
            <p className="text-gray-600 dark:text-gray-400 text-base sm:text-lg leading-relaxed mb-6">
              Our streamlined process means you get a professional website without the
              endless back-and-forth. We move fast without cutting corners.
            </p>

            {/* Benefits */}
            <div className="space-y-3">
              {[
                { label: "Typical turnaround: 7–10 days", icon: "🚀" },
                { label: "Transparent flat-rate pricing", icon: "💰" },
                { label: "No hidden fees or contracts", icon: "✅" },
                { label: "Lifetime support after launch", icon: "🛡️" },
              ].map((benefit) => (
                <div key={benefit.label} className="flex items-center gap-3 text-sm sm:text-base text-gray-700 dark:text-gray-300">
                  <span className="text-base">{benefit.icon}</span>
                  {benefit.label}
                </div>
              ))}
            </div>

            <a
              href="#contact"
              className="inline-flex items-center gap-2 mt-8 px-6 py-3 text-sm font-semibold rounded-full bg-gradient-to-r from-amber-500 to-orange-600 text-white hover:from-amber-600 hover:to-orange-700 transition-all shadow-md hover:shadow-lg"
            >
              Start Your Project
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </a>
          </motion.div>

          {/* Right: Steps */}
          <div>
            {steps.map((step, index) => (
              <StepCard key={step.number} step={step} index={index} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}