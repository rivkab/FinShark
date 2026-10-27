import type { CreatePersonRequest, PersonDto, RenamePersonRequest, SetPersonRolesRequest } from "@finshark/shared";
import { apiFetch } from "./api.ts";

// People are managed where they are used (DESIGN D16). These are the three calls; none of them needs
// a chosen person, so they also work on the "Who's using FinShark?" screen.

export const createPerson = (body: CreatePersonRequest): Promise<PersonDto> => apiFetch<PersonDto>("/api/people", { method: "POST", body });

export const setPersonRoles = (id: number, body: SetPersonRolesRequest): Promise<PersonDto> =>
  apiFetch<PersonDto>(`/api/people/${id}/roles`, { method: "PUT", body });

export const renamePerson = (id: number, displayName: string): Promise<PersonDto> => {
  const body: RenamePersonRequest = { displayName };
  return apiFetch<PersonDto>(`/api/people/${id}/name`, { method: "PUT", body });
};
