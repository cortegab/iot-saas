"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** "New dashboard" is a name dialog on the list (demo G); this route keeps
 * old links and the ⌘K "New dashboard" command working. */
export default function NewDashboardRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboards?new=1");
  }, [router]);
  return null;
}
