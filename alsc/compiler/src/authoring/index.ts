import type { DelamainShape } from "../delamain.ts";
import type { ModuleShape, SystemConfig } from "../schema.ts";

export type AlsSystemDefinition = SystemConfig;
export type AlsModuleDefinition = ModuleShape;
export type AlsDelamainDefinition = DelamainShape;

export function defineSystem<T extends AlsSystemDefinition>(definition: T): T {
  return definition;
}

export function defineModule<T extends AlsModuleDefinition>(definition: T): T {
  return definition;
}

export function defineDelamain<T extends AlsDelamainDefinition>(definition: T): T {
  return definition;
}
