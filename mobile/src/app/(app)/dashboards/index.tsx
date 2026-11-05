import { Stack } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Text } from "@/ui/Text";

// Filled in by M4 (dashboards); M2 ships the shell.
export default function Dashboards() {
  return (
    <View style={styles.page}>
      <Stack.Screen options={{ title: "Dashboards" }} />
      <Text color="inkMuted">Dashboards arrive in the next step of this build.</Text>
    </View>
  );
}

const styles = StyleSheet.create({ page: { flex: 1, padding: 16 } });
