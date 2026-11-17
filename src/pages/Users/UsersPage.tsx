import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Resolver } from 'react-hook-form';
import { KeyRound, Pencil, Plus, Power, UserPlus } from 'lucide-react';
import { z } from 'zod';
import type { AppUser } from '../../types/api';
import { appUserSchema, passwordSchema } from '../../types/schemas';
import { ROLE_LABELS } from '../../types/labels';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import { formatDateTime } from '../../utils/format';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { Modal } from '../../components/Modal';
import { Table, type Column } from '../../components/Table';
import { Badge } from '../../components/Badge';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { toast } from '../../components/Toast';
import { Alert } from '../../components/Alert';

type UserFormValues = z.input<typeof appUserSchema>;

const resetSchema = z.object({ newPassword: passwordSchema });
type ResetFormValues = z.infer<typeof resetSchema>;

export function UsersPage() {
  const { user: currentUser } = useAuth();
  const users = useAsync(async () => unwrap(await getApi().users.list()), []);

  const [editing, setEditing] = useState<AppUser | 'new' | null>(null);
  const [resetTarget, setResetTarget] = useState<AppUser | null>(null);
  const [toggleTarget, setToggleTarget] = useState<AppUser | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm<UserFormValues>({
    resolver: zodResolver(appUserSchema) as unknown as Resolver<UserFormValues>,
    defaultValues: { username: '', fullName: '', role: 'cashier', active: true, password: '' },
  });

  const resetForm = useForm<ResetFormValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { newPassword: '' },
  });

  const openNew = () => {
    form.reset({ username: '', fullName: '', role: 'cashier', active: true, password: '' });
    setFormError(null);
    setEditing('new');
  };

  const openEdit = (user: AppUser) => {
    form.reset({
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      active: user.active,
      password: '',
    });
    setFormError(null);
    setEditing(user);
  };

  const submitUser = form.handleSubmit(async (values) => {
    setIsSaving(true);
    setFormError(null);
    try {
      const parsed = appUserSchema.parse(values);
      unwrap(
        await getApi().users.save({
          ...parsed,
          password: parsed.password ? parsed.password : undefined,
        }),
      );
      toast.success(editing === 'new' ? 'User created' : 'User updated');
      setEditing(null);
      await users.reload();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  });

  const submitReset = resetForm.handleSubmit(async (values) => {
    if (!resetTarget) return;
    setIsSaving(true);
    setFormError(null);
    try {
      unwrap(await getApi().users.resetPassword(resetTarget.id, values.newPassword));
      toast.success('Password reset. The user must set a new one at next login.');
      setResetTarget(null);
      await users.reload();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  });

  const toggleActive = async () => {
    if (!toggleTarget) return;
    try {
      unwrap(await getApi().users.setActive(toggleTarget.id, !toggleTarget.active));
      toast.success(toggleTarget.active ? 'Account disabled' : 'Account enabled');
      await users.reload();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const columns: Column<AppUser>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (row) => (
        <div>
          <p className="font-medium">{row.fullName}</p>
          <p className="text-caption text-text-secondary">@{row.username}</p>
        </div>
      ),
    },
    { key: 'role', header: 'Role', render: (row) => ROLE_LABELS[row.role] },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1">
          <Badge tone={row.active ? 'success' : 'danger'}>
            {row.active ? 'Active' : 'Disabled'}
          </Badge>
          {row.mustChangePassword && <Badge tone="pending">Password change due</Badge>}
        </div>
      ),
    },
    {
      key: 'lastLogin',
      header: 'Last login',
      render: (row) => (row.lastLoginAt ? formatDateTime(row.lastLoginAt) : 'Never'),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" onClick={() => openEdit(row)} title="Edit user">
            <Pencil aria-hidden className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              resetForm.reset({ newPassword: '' });
              setFormError(null);
              setResetTarget(row);
            }}
            title="Reset password"
          >
            <KeyRound aria-hidden className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            onClick={() => setToggleTarget(row)}
            title={row.active ? 'Disable account' : 'Enable account'}
            disabled={row.id === currentUser?.id}
          >
            <Power
              aria-hidden
              className={`h-4 w-4 ${row.active ? 'text-status-cancelled' : 'text-status-success'}`}
            />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Create counter and manager accounts. Admin only."
        actions={
          <Button onClick={openNew}>
            <UserPlus aria-hidden className="h-4 w-4" />
            New user
          </Button>
        }
      />

      <Table
        columns={columns}
        rows={users.data ?? []}
        rowKey={(row) => row.id}
        isLoading={users.isLoading}
        emptyMessage="No users yet"
        emptyHint="Create a cashier account for the counter."
      />

      <p className="mt-3 text-caption text-text-secondary">
        New passwords are temporary. The user always sets their own password at first login.
      </p>

      <Modal
        isOpen={editing !== null}
        title={editing === 'new' ? 'New user' : 'Edit user'}
        description="Roles decide which pages and actions are available."
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={() => void submitUser()} isLoading={isSaving}>
              <Plus aria-hidden className="h-4 w-4" />
              {editing === 'new' ? 'Create user' : 'Save changes'}
            </Button>
          </>
        }
      >
        <form onSubmit={submitUser} className="flex flex-col gap-4" noValidate>
          {formError && <Alert tone="error">{formError}</Alert>}

          <Input
            label="Full name"
            error={form.formState.errors.fullName?.message}
            {...form.register('fullName')}
          />
          <Input
            label="Username"
            autoComplete="off"
            error={form.formState.errors.username?.message}
            {...form.register('username')}
          />
          <Select
            label="Role"
            options={[
              { value: 'cashier', label: 'Cashier — orders only' },
              { value: 'manager', label: 'Manager — orders, staff, vehicles, reports' },
              { value: 'admin', label: 'Admin — everything' },
            ]}
            error={form.formState.errors.role?.message}
            {...form.register('role')}
          />
          <Input
            label={editing === 'new' ? 'Temporary password' : 'New password (optional)'}
            type="password"
            autoComplete="new-password"
            hint="At least 8 characters. The user must change it at next login."
            error={form.formState.errors.password?.message}
            {...form.register('password')}
          />
          <label className="flex items-center gap-2 text-body">
            <input type="checkbox" className="h-4 w-4" {...form.register('active')} />
            Account is active
          </label>
        </form>
      </Modal>

      <Modal
        isOpen={resetTarget !== null}
        title="Reset password"
        description={resetTarget ? `Set a temporary password for ${resetTarget.fullName}.` : ''}
        onClose={() => setResetTarget(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetTarget(null)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={() => void submitReset()} isLoading={isSaving}>
              Reset password
            </Button>
          </>
        }
      >
        <form onSubmit={submitReset} className="flex flex-col gap-4" noValidate>
          {formError && <Alert tone="error">{formError}</Alert>}
          <Input
            label="Temporary password"
            type="password"
            autoComplete="new-password"
            error={resetForm.formState.errors.newPassword?.message}
            {...resetForm.register('newPassword')}
          />
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={toggleTarget !== null}
        title={toggleTarget?.active ? 'Disable this account?' : 'Enable this account?'}
        message={
          toggleTarget?.active
            ? `${toggleTarget.fullName} will not be able to sign in until the account is enabled again.`
            : `${toggleTarget?.fullName ?? ''} will be able to sign in again.`
        }
        confirmLabel={toggleTarget?.active ? 'Disable account' : 'Enable account'}
        tone={toggleTarget?.active ? 'danger' : 'primary'}
        onConfirm={toggleActive}
        onClose={() => setToggleTarget(null)}
      />
    </div>
  );
}
