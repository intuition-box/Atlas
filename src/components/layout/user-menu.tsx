import Link from "next/link";
import { auth, signIn, signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export default async function UserMenu() {
  const session = await auth();
  const isAuthed = !!(session?.user as any)?.id;

  return (
    <div className="relative ml-auto">
      <nav
        className={
          "flex items-center gap-6 transition-all duration-200 " +
          (isAuthed ? "" : "blur-[2px] pointer-events-none")
        }
        aria-hidden={isAuthed ? undefined : true}
      >
        <Link href="/dashboard" className="hover:text-white/90">Dashboard</Link>
        <Link href="/quests" className="hover:text-white/90">Quests</Link>
        <Link href="/settings" className="hover:text-white/90">Settings</Link>
        {isAuthed && (
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
            className="absolute right-0 top-full mt-2"
          >
            <Button
              variant="link"
              type="submit"
              className="rounded-full border border-white/15 px-3 py-1.5 text-white/80 hover:border-white/30 hover:bg-white/5 hover:text-white/90"
              title="Sign out"
            >
              Sign out
            </Button>
          </form>
        )}
      </nav>

      {!isAuthed && (
        <Button
          size="sm"
          className="absolute top-[50%] left-[50%] -translate-1/2"
        >
          <Link
            href="/signin"
            title="Connect socials to continue"
            aria-label="Connect socials to continue"
          >
            Connect
          </Link>
        </Button>
      )}
    </div>
  );
}
