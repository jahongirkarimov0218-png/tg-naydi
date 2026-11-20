import { Briefcase, Building2, LineChart, Send, ShieldAlert } from 'lucide-react';
import { Card } from '@/components/ui/card';

export function LandingSections() {
  const steps = [
    {
      num: 1,
      title: 'Загружаешь файл с телефонами',
      desc: 'Из своей CRM, заявок или базы, которую собрал сам. Формат номеров любой.',
    },
    {
      num: 2,
      title: 'Запускаешь проверку',
      desc: 'Номера идут пачками с паузами на отдельном аккаунте. Прогон можно остановить и продолжить.',
    },
    {
      num: 3,
      title: 'Получаешь файл с username и типом',
      desc: 'И дальше пишешь по username.',
    },
  ];

  const useCases = [
    {
      icon: Send,
      title: 'Telegram-рассылки',
      desc: 'Чистая база для предложений и уведомлений',
    },
    {
      icon: LineChart,
      title: 'Лидогенерация',
      desc: 'Проверка контактов перед работой',
    },
    {
      icon: Briefcase,
      title: 'Продажи и аутрич',
      desc: 'Больше точных контактов, меньше потерь',
    },
    {
      icon: Building2,
      title: 'Агентства',
      desc: 'Подготовка баз для клиентов',
    },
  ];

  return (
    <div className="space-y-12 pt-10">
      {/* 3 numbered steps */}
      <Card className="p-6 sm:p-8">
        <h2 className="mb-6 text-lg font-semibold tracking-tight text-balance text-zinc-950">
          Как это работает
        </h2>
        <div className="relative space-y-6">
          <div className="pointer-events-none absolute top-4 bottom-4 left-4 hidden w-px border-l border-dashed border-zinc-200 sm:block" />
          {steps.map((step) => (
            <div key={step.num} className="relative flex items-start gap-4">
              <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 font-mono text-xs font-semibold text-zinc-900 tabular-nums ring-4 ring-white">
                {step.num}
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-balance text-zinc-950">{step.title}</h3>
                <p className="mt-1 max-w-[65ch] text-sm leading-relaxed text-pretty text-zinc-600">
                  {step.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* 4 use-case cards */}
      <section>
        <h2 className="text-xl font-semibold tracking-tight text-balance text-zinc-950">
          Где это пригодится
        </h2>
        <p className="mt-1.5 text-sm text-pretty text-zinc-600">
          Подходит для своей базы: клиенты, заявки, партнёры.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {useCases.map((card) => {
            const Icon = card.icon;
            return (
              <Card
                key={card.title}
                className="p-5 transition-colors duration-150 hover:border-zinc-300 hover:bg-zinc-50/40"
              >
                <div className="flex items-start gap-3.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-900">
                    <Icon className="h-4 w-4" strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-balance text-zinc-950">
                      {card.title}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-pretty text-zinc-600">
                      {card.desc}
                    </p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Compliance & PII footer */}
      <footer className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-4 text-xs leading-relaxed text-zinc-600">
        <div className="flex items-start gap-2.5">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" strokeWidth={1.75} />
          <p className="max-w-[75ch] text-pretty">
            Сервис предназначен только для работы с собственной CRM-базой клиентов и заявок с
            соблюдением правил Telegram и законодательства о персональных данных. Номера в
            интерфейсе маскируются, доступ к задаче защищён секретным токеном, а загруженные базы
            автоматически удаляются через 24 часа (либо мгновенно по кнопке «Удалить базу»).
          </p>
        </div>
      </footer>
    </div>
  );
}
