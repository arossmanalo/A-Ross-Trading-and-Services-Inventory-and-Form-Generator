/**
 * Label frozen onto each per-machine service row and shown on documents.
 * Must match the formula in the v11 migration (SCHEMA_V11).
 */
export function formatMachineLabel(machine: { machineType: string; nicknameOrLocation: string; serialNumber: string }): string {
  if (machine.nicknameOrLocation) return `${machine.machineType} · ${machine.nicknameOrLocation}`;
  if (machine.serialNumber) return `${machine.machineType} · SN ${machine.serialNumber}`;
  return machine.machineType;
}
