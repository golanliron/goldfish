'use client';

import { useState, useEffect } from 'react';
import type { SidebarTab, AppStage } from '@/types';
import OrgTab from './OrgTab';
import OpportunitiesTab from './OpportunitiesTab';
import BusinessTab from './BusinessTab';
import OnboardingProgressBanner from '@/components/OnboardingProgressBanner';

interface SidebarPanelProps {
  stage: AppStage;
  orgId: string | null;
  initialTab?: SidebarTab;
}

const tabs: { id: SidebarTab; label: string; icon: string }[] = [
  { id: 'org', label: 'פרופיל הארגון שלי', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
  { id: 'opportunities', label: 'הגשות פתוחות', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' },

  { id: 'business', label: 'חברות עסקיות', icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' },
  { id: 'foundations', label: 'קרנות ופדרציות', icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
];

export default function SidebarPanel({ stage, orgId, initialTab }: SidebarPanelProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>(initialTab || 'org');

  // Sync with parent initialTab changes (mobile tab switching)
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  // Listen for tab switch events (e.g. from WhatUrgentNow dashboard cards)
  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent<string>).detail as SidebarTab;
      if (tab && ['org', 'opportunities', 'business', 'foundations'].includes(tab)) {
        setActiveTab(tab);
      }
    };
    window.addEventListener('fishgold:activeTab', handler);
    return () => window.removeEventListener('fishgold:activeTab', handler);
  }, []);

  // On mobile, hide the tab bar (bottom nav handles it)
  const isMobileView = initialTab !== undefined;

  return (
    <div className="flex flex-col h-full bg-bg2 border-r border-border">
      {/* Tab buttons - hidden on mobile (bottom nav replaces this) */}
      {!isMobileView && (
        <div className="flex border-b border-border">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                window.dispatchEvent(new CustomEvent('fishgold:activeTab', { detail: tab.id }));
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-colors relative cursor-pointer
                ${activeTab === tab.id ? 'text-accent' : 'text-muted hover:text-text'}
              `}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={tab.icon} />
              </svg>
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute bottom-0 inset-x-2 h-0.5 bg-accent rounded-full" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Onboarding scan progress — shown for orgs with Drive connected, auto-dismissed */}
      {orgId && <OnboardingProgressBanner orgId={orgId} />}

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'org' && (
          <div className="p-4">
            <OrgTab stage={stage} orgId={orgId} />
          </div>
        )}
        {activeTab === 'opportunities' && <OpportunitiesTab stage={stage} orgId={orgId} />}

        {activeTab === 'business' && <BusinessTab stage={stage} orgId={orgId} companyTypeFilter="business" />}
        {activeTab === 'foundations' && <BusinessTab stage={stage} orgId={orgId} companyTypeFilter="fund" />}
      </div>
    </div>
  );
}
