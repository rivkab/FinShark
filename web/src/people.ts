import type { CreatePersonRequest, PersonDto, SetPersonRolesRequest } from "@finshark/shared";
import { api } from "./api.ts";

// People are managed where they are used (DESIGN D16). These are the three calls; none of them needs
// a chosen person, so they also work on the "Who's using FinShark?" screen.

export const createPerson = (body: CreatePersonRequest): Promise<PersonDto> => api.people.create(body);

export const setPersonRoles = (id: number, body: SetPersonRolesRequest): Promise<PersonDto> =>
  api.people.setRoles(id, body);

export const renamePerson = (id: number, displayName: string): Promise<PersonDto> => {
  return api.people.rename(id, displayName);
};
