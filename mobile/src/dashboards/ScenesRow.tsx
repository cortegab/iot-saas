import type { components } from "@iodriven/shared/api";
import { actionsText } from "@iodriven/shared/rule-text";
import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

type RuleResponse = components["schemas"]["RuleResponse"];

/** The web's Scenes row (DESIGN.md §15a; ease-of-use C5): manual rules an
 * admin opened to clients, one button each; asks, then runs it. */
export function ScenesRow() {
  const api = useApi();
  const { data: rules } = useApiSWR<RuleResponse[]>("/rules");
  const [running, setRunning] = useState<string | null>(null);
  const scenes = (rules ?? []).filter((r) => r.enabled && r.clients_can_run && r.trigger.type === "manual");
  if (scenes.length === 0) return null;

  function run(rule: RuleResponse) {
    const what = actionsText(rule.actions);
    Alert.alert(`Run ${rule.name}?`, `${what}.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Run it",
        onPress: () => {
          setRunning(rule.id);
          api
            .post(`/rules/${rule.id}/run`)
            .then(() => Alert.alert(`${rule.name} is running`, what))
            .catch(() => Alert.alert(`Couldn't run ${rule.name}`, "Check the connection and try again."))
            .finally(() => setRunning(null));
        },
      },
    ]);
  }

  return (
    <View style={styles.row} accessibilityLabel="Scenes">
      <Text size="meta" weight="medium" color="inkMuted">
        Scenes
      </Text>
      {scenes.map((r) => (
        <Button key={r.id} label={r.name} variant="secondary" disabled={running === r.id} onPress={() => run(r)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
});
