import { AppShell } from "@/components/AppShell";
import { Studio } from "@/components/Studio";
import { toPublicSettings } from "@/lib/settings";
import { getVideoProviderName } from "@/lib/providers";

/**
 * The settings are resolved on the server and handed down as the shell's
 * initial state.
 *
 * Fetching them from the browser instead meant the header briefly claimed
 * nothing was connected on every load — and the one thing that indicator must
 * never do is understate whether a render is going to cost money.
 */
export const dynamic = "force-dynamic";

export default async function Home() {
  return (
    <AppShell initialSettings={await toPublicSettings(getVideoProviderName())}>
      <Studio />
    </AppShell>
  );
}
