"use client";

import { PageHeader } from "@/components/ui/PageHeader";
import KeysSection from "./keys-section";

export default function ApiKeysPage() {
  return (
    <>
      <PageHeader title="API keys" description="Keys let scripts and other services call the API on this workspace's behalf." />
      <KeysSection />
    </>
  );
}
