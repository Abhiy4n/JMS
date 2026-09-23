type AuthLayoutProps = {
  children: React.ReactNode;
};

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-svh flex-1 items-center justify-center bg-white p-4 sm:p-6 md:p-8">
      {/* Centered card — split into two halves */}
      <div className="grid w-full max-w-5xl overflow-hidden rounded-2xl border border-[#E8E8E8] shadow-sm sm:rounded-3xl md:aspect-[16/10] md:grid-cols-2 md:max-h-[min(640px,85vh)]">
        {/* Left: SVG */}
        <div className="flex items-center justify-center bg-[#E5E5E5] px-6 py-10 sm:px-10 sm:py-12 md:h-full md:py-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/gemini-svg.svg"
            alt=""
            className="h-auto w-full max-h-40 select-none object-contain sm:max-h-48 md:max-h-[85%]"
          />
        </div>

        {/* Right: login / signup */}
        <div className="flex flex-col justify-center bg-white px-7 py-10 sm:px-10 sm:py-12 md:h-full md:overflow-y-auto md:px-12 md:py-10">
          {children}
        </div>
      </div>
    </div>
  );
}
