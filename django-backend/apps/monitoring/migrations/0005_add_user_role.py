from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('monitoring', '0004_add_systemsetting'),
    ]

    operations = [
        migrations.AddField(
            model_name='monitoringuser',
            name='role',
            field=models.CharField(choices=[('user', 'User'), ('admin', 'Admin')], default='user', max_length=20),
        ),
    ]
