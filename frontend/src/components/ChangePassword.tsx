import { Form, Input, Modal, message } from 'antd';
import { api, errMsg } from '../api/client';

export default function ChangePassword({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  return (
    <Modal
      title="Change password"
      open={open}
      onCancel={onClose}
      okText="Save"
      destroyOnHidden
      onOk={async () => {
        const v = await form.validateFields();
        try {
          await api.post('/auth/change-password', v);
          message.success('Password changed');
          form.resetFields();
          onClose();
        } catch (e) {
          message.error(errMsg(e));
        }
      }}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="currentPassword" label="Current password" rules={[{ required: true }]}>
          <Input.Password />
        </Form.Item>
        <Form.Item name="newPassword" label="New password" rules={[{ required: true, min: 6 }]}>
          <Input.Password />
        </Form.Item>
      </Form>
    </Modal>
  );
}
