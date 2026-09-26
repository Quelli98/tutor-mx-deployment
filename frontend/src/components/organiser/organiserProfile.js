import { createContext, useContext } from 'react'

/** The signed-in organiser's display name, provided by OrganiserShell (null outside it). */
export const OrganiserNameContext = createContext(null)

export function useOrganiserName() {
  return useContext(OrganiserNameContext)
}
