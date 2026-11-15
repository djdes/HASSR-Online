import React from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import { Toaster } from 'sonner';
import { CalendarRange } from 'lucide-react';
import { StaffPageClient } from '@/components/staff/staff-page-client';
import { ScheduleEditor } from '@/components/settings/schedule-editor';
import { SceneFrame } from '@/components/landing/qr-player/scene';
import { CHAPTER_FRAMES, sceneFrame } from '@/components/landing/qr-player/chapters';
import qr from './qr.json';
import { BrandLogo } from '@/components/brand/logo';
import LoginClient from '@/app/(auth)/login/login-client';
import ru from '@/i18n/messages/ru.json';
import en from '@/i18n/messages/en.json';
import uz from '@/i18n/messages/uz.json';
import type { StaffEmployee, StaffPageProps } from '@/components/staff/staff-types';

const query = new URLSearchParams(location.search);
const locale = (query.get('locale') || 'ru') as 'ru' | 'en' | 'uz';
const mode = query.get('mode') || 'staff';
const messages = {ru,en,uz}[locale];
const labels = {
  ru: ['Руководитель','Администратор','Специалист','Уборщик'],
  en: ['Manager','Administrator','Specialist','Cleaner'],
  uz: ['Rahbar','Administrator','Mutaxassis','Farrosh'],
}[locale];
const names = ['Анна Иванова','Олег Петров','Мария Соколова','Елена Козлова','Иван Смирнов','Ирина Волкова'];
const positions: StaffPageProps['positions'] = labels.map((name,i)=>({id:`position-${i}`,name,categoryKey:i===0?'management':'staff',sortOrder:i}));
const employees: StaffEmployee[] = names.map((name,i)=>({id:`employee-${i}`,name,email:`employee-${i}@example.test`,phone:null,
  jobPositionId:positions[Math.min(i,3)].id,positionTitle:labels[Math.min(i,3)],role:i===0?'manager':'cook',
  isActive:true,isRoot:false,isSelf:i===0,telegramLinked:true,weeklyDaysOff:[],hasQrPin:true,buildingIds:[]}));
const props: StaffPageProps = {organization:{id:'neutral-demo',name:'WeSetup Demo'},telegramBotUrl:null,hasTasksflowIntegration:true,
  positions,employees,positionSuggestions:{management:[],staff:[],commission:[]},workOffDays:[],vacations:[],sickLeaves:[],dismissals:[],todayKey:'2026-11-15'};

function Schedule() {
  const t = useTranslations('settingsUi.schedulePage');
  return <><div className="mb-6 flex items-start gap-4"><span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]"><CalendarRange className="size-5"/></span><div>
    <h1 className="text-[32px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t('title')}</h1>
    <p className="mt-1.5 max-w-[680px] text-[14px] leading-relaxed text-[#6f7282]">{t('intro')}</p>
    <p className="mt-2 max-w-[680px] rounded-2xl border border-[#dcdfed] bg-[#f8f9fc] px-4 py-3 text-[13px] leading-relaxed text-[#6f7282]">
      <strong className="font-semibold text-[#0b1024]">{t('noteDay')}</strong> {t('noteDayBody')}<br/>
      <strong className="font-semibold text-[#0b1024]">{t('noteLong')}</strong> {t.rich('noteLongBody',{link:chunks=><a href="/settings/users">{chunks}</a>})}
    </p></div></div><ScheduleEditor startYmd="2026-11-15" endYmd="2026-11-21" positions={positions}
      users={employees.map(e=>({id:e.id,name:e.name,role:e.role,jobPositionId:e.jobPositionId,jobPositionName:e.positionTitle,categoryKey:e.isSelf?'management':'staff'}))}
      shifts={employees.map(e=>({userId:e.id,date:'2026-11-15',status:'scheduled',jobPositionId:e.jobPositionId}))}/></>;
}

function Fixture() {
  return <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Moscow">
    {mode==='login'?<LoginClient/>:mode==='qr'?<div style={{position:'relative',containerType:'inline-size',aspectRatio:'16 / 9',background:'#0f1430',overflow:'hidden'}}>
      <SceneFrame frame={CHAPTER_FRAMES+sceneFrame(Number(query.get('time')||'1.5'))} fridgeTemp={3.4} bodyTemp={36.6}
        today={{day:15,month:11,year:2026,daysInMonth:30,monthLabel:'ноябрь 2026'}} qr={qr}/>
    </div>:<><header className="flex h-16 items-center justify-between border-b border-[#ececf4] bg-white px-5 text-[#0b1024]">
      <BrandLogo height={24}/><span className="text-[13px] text-[#6f7282]">WeSetup Demo</span></header>
      <main className="mx-auto max-w-[1440px] p-4 md:p-8">{mode==='staff'?<StaffPageClient {...props}/>:<Schedule/>}</main></>}
    <Toaster/>
  </NextIntlClientProvider>;
}
createRoot(document.getElementById('app')!).render(<Fixture/>);
