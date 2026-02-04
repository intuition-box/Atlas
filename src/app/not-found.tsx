export default function NotFound() {
  return (
    <div className="h-screen text-center flex flex-col items-center justify-center">
      <div>
        <h2 className="inline-block mr-5 pr-6 text-2xl font-medium align-top leading-[49px] border-r border-black/30 dark:border-white/30">
          404
        </h2>
        <p className="uppercase inline-block text-sm font-normal leading-[49px] m-0">
          This page could not be found.
        </p>
      </div>
    </div>
  );
}
