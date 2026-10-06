import { useState } from 'react'
import { toast } from 'sonner'
import { Link, Outlet, useLocation } from '@tanstack/react-router'
import {
  BookOpen,
  Box,
  Castle,
  ChevronsUpDown,
  Church,
  Crown,
  DatabaseZap,
  Landmark,
  Layers,
  Map as MapIcon,
  Package,
  PanelLeft,
  Settings,
  Shield,
  Undo2
} from 'lucide-react'
import { useApp } from './AppContext'
import logo from './assets/logo.png'
import ModPicker from './components/ModPicker'
import ReaderProvider from './components/story/ReaderProvider'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  useSidebar
} from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { Spinner } from '@/components/ui/spinner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const TOOLS = [
  { to: '/characters', label: 'Character Editor', icon: Crown },
  { to: '/dynasties', label: 'Dynasty & House Editor', icon: Shield },
  { to: '/titles', label: 'Title Editor', icon: Castle },
  { to: '/faiths', label: 'Faith Editor', icon: Church },
  { to: '/rites', label: 'Rite Editor', icon: Church },
  { to: '/religions', label: 'Religion Editor', icon: BookOpen },
  { to: '/cultures', label: 'Culture Editor', icon: Landmark }
] as const

/** Views of the whole game plus the mod, from the game index (ported from CrusaderPope) */
const EXPLORE = [
  { to: '/map', label: 'Map', icon: MapIcon },
  { to: '/models', label: '3D Models', icon: Box },
  { to: '/mods', label: 'Mods', icon: Layers }
] as const

/**
 * The game index's progress, at the foot of the sidebar while it builds or
 * after it failed; nothing once it's ready. Leads to its Settings card.
 */
function IndexStatusItem(): React.JSX.Element | null {
  const { indexStatus } = useApp()
  if (indexStatus.state !== 'indexing' && indexStatus.state !== 'error') return null
  const indexing = indexStatus.state === 'indexing'
  const pct =
    indexing && indexStatus.total
      ? Math.round((100 * (indexStatus.done ?? 0)) / indexStatus.total)
      : null
  const label = indexing
    ? `Indexing the game — ${indexStatus.phase ?? 'starting'}${pct !== null ? ` ${pct}%` : ''}`
    : 'Game index failed'
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        tooltip={label}
        className={cn(!indexing && 'text-destructive hover:text-destructive')}
      >
        <Link to="/settings">
          {indexing ? <Spinner /> : <DatabaseZap />}
          <span className="truncate text-xs">{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

/**
 * Takes back the selected mod's last change — a save in any editor, an edit
 * from the map, a Blender import (CrusaderPope's undo journal, kept across
 * restarts). Only when there is one.
 */
function UndoItem(): React.JSX.Element | null {
  const { undoSteps } = useApp()
  const [busy, setBusy] = useState(false)
  const last = undoSteps[0]
  if (!last) return null
  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.ck3tools.undo()
      if (!r) return
      if (r.refused) toast.error(`Can't undo “${r.label}”`, { description: r.refused })
      else toast.success(`Undid “${r.label}”`, { description: r.left ? `${r.left} more to undo` : undefined })
    } catch (e) {
      toast.error('Undo failed', { description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }
  return (
    <SidebarMenuItem>
      <SidebarMenuButton disabled={busy} tooltip={`Undo: ${last.label}`} onClick={() => void run()}>
        <Undo2 />
        <span className="truncate">Undo: {last.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function CollapseButton(): React.JSX.Element {
  const { state, toggleSidebar } = useSidebar()
  return (
    <SidebarMenuButton
      onClick={toggleSidebar}
      tooltip={state === 'collapsed' ? 'Expand sidebar' : 'Collapse sidebar'}
    >
      <PanelLeft />
      <span>Collapse</span>
    </SidebarMenuButton>
  )
}

export default function RootLayout(): React.JSX.Element {
  const { settings, selectedMod, refreshMods } = useApp()
  const { pathname } = useLocation()
  const [modDialogOpen, setModDialogOpen] = useState(false)

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">Loading…</div>
    )
  }

  const configured = Boolean(settings.gameDir && settings.modDir)

  return (
    <TooltipProvider>
      <ReaderProvider>
        <SidebarProvider>
          <Sidebar collapsible="icon" variant="inset">
            <SidebarHeader>
              <img
                src={logo}
                alt="Mod Editor"
                draggable={false}
                className="mx-auto h-16 w-auto px-2 pt-1 group-data-[collapsible=icon]:hidden"
              />
              <SidebarMenu>
                <SidebarMenuItem>
                  <Dialog open={modDialogOpen} onOpenChange={setModDialogOpen}>
                    <DialogTrigger asChild>
                      <SidebarMenuButton
                        size="lg"
                        tooltip={selectedMod ? selectedMod.name : 'Select a mod'}
                        className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                      >
                        <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                          <Package className="size-4" />
                        </div>
                        <div className="grid flex-1 text-left text-sm leading-tight">
                          <span className="truncate font-medium">
                            {selectedMod ? selectedMod.name : 'Select a mod…'}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {selectedMod ? selectedMod.file : 'No active mod'}
                          </span>
                        </div>
                        <ChevronsUpDown className="ml-auto" />
                      </SidebarMenuButton>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle>Active mod</DialogTitle>
                        <DialogDescription>
                          The tools will read from the game directory and read/write to the selected
                          mod.
                        </DialogDescription>
                      </DialogHeader>
                      <ModPicker plain onSelect={() => setModDialogOpen(false)} />
                      <DialogFooter className="sm:justify-start">
                        <Button variant="outline" size="sm" onClick={refreshMods}>
                          Refresh
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarHeader>
            <SidebarContent>
              {(
                [
                  ['Editors', TOOLS],
                  ['Explore', EXPLORE]
                ] as const
              ).map(([group, tools]) => (
                <SidebarGroup key={group}>
                  <SidebarGroupLabel>{group}</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {tools.map((tool) => (
                        <SidebarMenuItem key={tool.to}>
                          {configured ? (
                            <SidebarMenuButton
                              asChild
                              isActive={pathname === tool.to}
                              tooltip={tool.label}
                            >
                              {/* search={{}} so a tool link always lands on its list, never
                              back into whatever row the search params had open */}
                              <Link to={tool.to} search={{}}>
                                <tool.icon />
                                <span>{tool.label}</span>
                              </Link>
                            </SidebarMenuButton>
                          ) : (
                            <SidebarMenuButton
                              disabled
                              tooltip="Configure directories in Settings first"
                            >
                              <tool.icon />
                              <span>{tool.label}</span>
                            </SidebarMenuButton>
                          )}
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              ))}
            </SidebarContent>
            <SidebarFooter>
              <SidebarMenu>
                <UndoItem />
              <IndexStatusItem />
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === '/settings'} tooltip="Settings">
                    <Link to="/settings">
                      <Settings />
                      <span>Settings</span>
                    </Link>
                  </SidebarMenuButton>
                  {!configured && (
                    <SidebarMenuBadge className="rounded-full bg-destructive font-bold text-white">
                      !
                    </SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <CollapseButton />
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarFooter>
            <SidebarRail />
          </Sidebar>
          {/* The inset variant floats the page as a card with a 0.5rem margin all round */}
          <SidebarInset className="h-svh overflow-hidden md:h-[calc(100svh-1rem)]">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Outlet />
            </div>
          </SidebarInset>
          <Toaster />
        </SidebarProvider>
      </ReaderProvider>
    </TooltipProvider>
  )
}
