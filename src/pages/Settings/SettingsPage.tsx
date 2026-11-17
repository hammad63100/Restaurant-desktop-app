import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Resolver } from 'react-hook-form';
import { Database, Download, ImageUp, Save, Trash2, Upload } from 'lucide-react';
import { z } from 'zod';
import type { BackupFile } from '../../types/api';
import { shopSettingsSchema } from '../../types/schemas';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import { useSettingsStore } from '../../store/settingsStore';
import { formatDateTime } from '../../utils/format';
import { Button } from '../../components/Button';
import { Card, CardHeading } from '../../components/Card';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { toast } from '../../components/Toast';
import { Alert } from '../../components/Alert';

/** Form values keep the defaulted fields optional; the schema fills them in. */
type SettingsFormValues = z.input<typeof shopSettingsSchema>;

export function SettingsPage() {
  const { can } = useAuth();
  const canWrite = can('settings');
  const settings = useSettingsStore((state) => state.settings);
  const saveSettings = useSettingsStore((state) => state.save);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<BackupFile | null>(null);

  const backups = useAsync(async () => unwrap(await getApi().settings.listBackups()), []);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<SettingsFormValues>({
    resolver: zodResolver(shopSettingsSchema) as unknown as Resolver<SettingsFormValues>,
    defaultValues: settings,
  });

  const logo = watch('shopLogo');

  useEffect(() => {
    reset(settings);
  }, [settings, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await saveSettings(shopSettingsSchema.parse(values));
      toast.success('Shop settings saved');
    } catch (error) {
      const message = errorMessage(error, 'Could not save the settings');
      setSaveError(message);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  });

  const handlePickLogo = async () => {
    try {
      const dataUrl = unwrap(await getApi().settings.pickLogo());
      if (dataUrl) setValue('shopLogo', dataUrl, { shouldDirty: true });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const handleBackup = async () => {
    try {
      const file = unwrap(await getApi().settings.createBackup());
      toast.success(file ? `Backup saved: ${file.fileName}` : 'Backup could not be created');
      await backups.reload();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const handleRestore = async () => {
    if (!restoreTarget) return;
    try {
      unwrap(await getApi().settings.restoreBackup(restoreTarget.path));
      toast.success('Database restored. The app will reload now.');
      setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div>
      <PageHeader title="Settings" subtitle="Shop details, tax, receipt and database backups." />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <form onSubmit={onSubmit} className="xl:col-span-2" noValidate>
          <Card>
            <CardHeading
              title="Shop details"
              subtitle="These appear on the invoice and in the sidebar."
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Shop name" error={errors.shopName?.message} {...register('shopName')} />
              <Input label="Phone" error={errors.shopPhone?.message} {...register('shopPhone')} />
              <div className="sm:col-span-2">
                <Input
                  label="Address"
                  error={errors.shopAddress?.message}
                  {...register('shopAddress')}
                />
              </div>
              <Input
                label="Currency label"
                hint="Shown before amounts, e.g. PKR 1,250.00"
                error={errors.currency?.message}
                {...register('currency')}
              />
              <Input
                label="Tax percent"
                type="number"
                min={0}
                max={100}
                step={1}
                hint="Default tax used on new orders. Use 0 if you do not charge tax."
                error={errors.taxPercent?.message}
                {...register('taxPercent', { valueAsNumber: true })}
              />
              <Select
                label="Receipt paper"
                options={[
                  { value: '80mm', label: '80mm thermal' },
                  { value: 'a4', label: 'A4 page' },
                ]}
                error={errors.receiptWidth?.message}
                {...register('receiptWidth')}
              />
              <label className="flex items-center gap-2 pt-6 text-body text-text-primary">
                <input type="checkbox" className="h-4 w-4" {...register('backupOnClose')} />
                Back up the database when the app closes
              </label>
            </div>

            <div className="mt-6 border-t border-border pt-4">
              <p className="mb-2 text-caption text-text-secondary">Shop logo</p>
              <div className="flex items-center gap-4">
                {logo ? (
                  <img
                    src={logo}
                    alt="Shop logo preview"
                    className="h-16 w-16 rounded-card border border-border object-contain p-1"
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-card border border-dashed border-border text-text-secondary">
                    —
                  </div>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => void handlePickLogo()}
                    disabled={!canWrite}
                  >
                    <ImageUp aria-hidden className="h-4 w-4" />
                    Choose image
                  </Button>
                  {logo && (
                    <Button
                      variant="ghost"
                      onClick={() => setValue('shopLogo', null, { shouldDirty: true })}
                    >
                      <Trash2 aria-hidden className="h-4 w-4" />
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {saveError && (
              <div className="mt-4">
                <Alert tone="error">{saveError}</Alert>
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <Button type="submit" isLoading={isSaving}>
                <Save aria-hidden className="h-4 w-4" />
                Save settings
              </Button>
            </div>
          </Card>
        </form>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeading
              title="Backup and restore"
              subtitle="A copy of the database file on this computer."
            />

            <Button variant="secondary" fullWidth onClick={() => void handleBackup()}>
              <Database aria-hidden className="h-4 w-4" />
              Create a backup now
            </Button>

            <div className="mt-4 flex flex-col gap-2">
              {backups.isLoading && (
                <p className="text-caption text-text-secondary">Loading backups…</p>
              )}

              {!backups.isLoading && (backups.data ?? []).length === 0 && (
                <p className="text-caption text-text-secondary">
                  No backups yet. An automatic backup is kept when the app closes.
                </p>
              )}

              {(backups.data ?? []).map((file) => (
                <div
                  key={file.path}
                  className="flex items-center justify-between gap-2 rounded-control border border-border p-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-caption font-medium text-text-primary">
                      {file.fileName}
                    </p>
                    <p className="text-[11px] text-text-secondary">
                      {formatDateTime(file.createdAt.replace('T', ' ').slice(0, 19))} ·{' '}
                      {(file.sizeBytes / 1024).toFixed(0)} KB
                    </p>
                  </div>
                  <Button variant="ghost" onClick={() => setRestoreTarget(file)}>
                    <Upload aria-hidden className="h-4 w-4" />
                    Restore
                  </Button>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeading title="Data location" />
            <p className="text-caption text-text-secondary">
              Shop data is stored only on this computer, inside your Windows user profile (AppData).
              Copy a backup to a USB drive regularly.
            </p>
            <p className="mt-3 flex items-center gap-1 text-caption text-text-secondary">
              <Download aria-hidden className="h-3.5 w-3.5" />
              Backups are plain .db files you can keep anywhere.
            </p>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        isOpen={restoreTarget !== null}
        title="Restore this backup?"
        message={`All current data will be replaced with ${restoreTarget?.fileName ?? ''}. A safety backup of the current data is taken first.`}
        confirmLabel="Restore database"
        onConfirm={handleRestore}
        onClose={() => setRestoreTarget(null)}
      />
    </div>
  );
}
