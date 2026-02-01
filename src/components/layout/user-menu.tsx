import Link from "next/link";
import { auth, signOut } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Separator } from "../ui/separator";
import { ROUTES } from "@/lib/routes";

export default async function UserMenu() {
  const session = await auth();
  const isAuthed = !!(session?.user as any)?.id;

  return (


    <nav
      className=" ml-auto flex flex-col gap-2 py-4 transition-all duration-200"
      aria-hidden={isAuthed ? undefined : true}
    >
      <Link href="/about" className="hover:text-white/90">About</Link>

      {isAuthed && (
        <>
        <Link href="/quests" className="hover:text-white/90">Quests</Link>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <Button
            variant="link"
            type="submit"
            className="p-0 m-0 h-auto"
          >
            Sign out
          </Button>
        </form>
        </>
      )}

      {!isAuthed && (
        <Button
          variant="link"
          type="submit"
          className="p-0 m-0 h-auto"
        >
          <Link
            href={ROUTES.signIn}
            aria-label="Connect socials to continue"
          >
            Connect
          </Link>
        </Button>
      )}
    </nav>
  );
}
