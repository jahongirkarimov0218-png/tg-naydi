import { Briefcase, Building2, LineChart, Send, ShieldAlert } from 'lucide-react';

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
    <div className="space-y-12 pt-6">
      {/* 3 numbered steps (ref-01) */}
      <section className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="mb-6 text-xl font-bold tracking-tight text-slate-900">Как это работает</h2>
        <div className="relative space-y-6">
          <div className="pointer-events-none absolute top-4 bottom-4 left-4 hidden w-px border-l border-dashed border-blue-200 sm:block" />
          {steps.map((step) => (
            <div key={step.num} className="relative flex items-start gap-4">
              <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-bold text-blue-600 ring-4 ring-white">
                {step.num}
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900">{step.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-500">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 4 use-case cards (ref-01) */}
      <section>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Где это пригодится</h2>
        <p className="mt-1.5 text-sm text-slate-500">
          Подходит для своей базы: клиенты, заявки, партнёры.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {useCases.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.title}
                className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:border-blue-200 hover:shadow-md"
              >
                <div className="flex items-start gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">{card.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-slate-500">{card.desc}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Compliance & PII footer */}
      <footer className="rounded-2xl border border-slate-200/70 bg-white/70 p-4 text-xs leading-relaxed text-slate-500">
        <div className="flex items-start gap-2.5">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <p>
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
